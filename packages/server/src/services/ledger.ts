import {
  AppError,
  costStep,
  type CostState,
  Decimal,
  type LedgerMovement,
  type MovementType,
  replayLedger,
  signedQuantity,
  ZERO_COST_STATE,
} from '@inventory/shared';
import { asMicro, asSatang } from '@inventory/shared';
import type { Queryable } from '../db/client.js';
import { advisoryXactLock } from '../db/lock.js';
import { assertPeriodOpen } from './periods.js';
import type { NegativeStockMode } from './settings.js';

export interface PostMovementParams {
  productId: string;
  type: MovementType;
  occurredOn: string;
  /** Positive magnitude for non-ADJUSTMENT types. */
  quantityMagnitude?: string;
  /** Signed delta for ADJUSTMENT. */
  signedDelta?: string;
  unitCostSatang?: number | null;
  sourceKind: 'OPENING' | 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT' | 'INVOICE';
  sourceId?: string | null;
  sourceRowHash?: string | null;
  localId?: string | null;
  negativeStockMode: NegativeStockMode;
}

export interface PostMovementResult {
  movementId: string;
  seq: number;
  qtyBefore: string;
  qtyAfter: string;
  avgCostMicroAfter: number;
  totalCostSatangAfter: number;
  cogsSatang: number;
  costBasisReset: boolean;
}

async function loadCostState(tx: Queryable, productId: string): Promise<CostState> {
  const { rows } = await tx.query<{
    qty_on_hand: string;
    total_cost_satang: string;
    avg_cost_micro: string;
    last_nonzero_avg_micro: string;
  }>(
    `SELECT qty_on_hand, total_cost_satang, avg_cost_micro, last_nonzero_avg_micro
     FROM stock_state WHERE product_id = $1 FOR UPDATE`,
    [productId],
  );
  if (!rows[0]) {
    await tx.query('INSERT INTO stock_state (product_id) VALUES ($1)', [productId]);
    return ZERO_COST_STATE;
  }
  const r = rows[0];
  return {
    qtyOnHand: new Decimal(r.qty_on_hand),
    totalCostSatang: asSatang(Number(r.total_cost_satang)),
    avgCostMicro: asMicro(Number(r.avg_cost_micro)),
    lastNonzeroAvgMicro: asMicro(Number(r.last_nonzero_avg_micro)),
  };
}

async function writeCostState(tx: Queryable, productId: string, s: CostState, seq: number): Promise<void> {
  await tx.query(
    `UPDATE stock_state
     SET qty_on_hand = $2, total_cost_satang = $3, avg_cost_micro = $4,
         last_nonzero_avg_micro = $5, last_seq = GREATEST(last_seq, $6), updated_at = now()
     WHERE product_id = $1`,
    [
      productId,
      s.qtyOnHand.toString(),
      s.totalCostSatang,
      s.avgCostMicro,
      s.lastNonzeroAvgMicro,
      seq,
    ],
  );
}

/**
 * Append one movement to the ledger and roll the derived cache forward, inside the
 * caller's transaction (spec §5, §9.2, §14.2; DATABASE.md §4.1).
 */
export async function postMovementTx(
  tx: Queryable,
  p: PostMovementParams,
): Promise<PostMovementResult> {
  await advisoryXactLock(tx, p.productId);

  const prod = await tx.query('SELECT 1 FROM products WHERE id = $1', [p.productId]);
  if (prod.rows.length === 0) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบสินค้า' });

  const periodId = await assertPeriodOpen(tx, p.occurredOn);
  const state = await loadCostState(tx, p.productId);

  const magnitudeOrDelta = p.type === 'ADJUSTMENT' ? p.signedDelta! : p.quantityMagnitude!;
  const signed = signedQuantity(p.type, magnitudeOrDelta);

  if (
    p.negativeStockMode === 'PREVENT' &&
    signed.lt(0) &&
    state.qtyOnHand.plus(signed).lt(0)
  ) {
    throw new AppError('STOCK_WOULD_GO_NEGATIVE', {
      details: {
        productId: p.productId,
        currentStock: state.qtyOnHand.toString(),
        requested: signed.abs().toString(),
        shortfall: state.qtyOnHand.plus(signed).abs().toString(),
      },
    });
  }

  const inserted = await tx.query<{ id: string; seq: string }>(
    `INSERT INTO movements
       (product_id, type, quantity, occurred_on, period_id, unit_cost_satang,
        source_kind, source_id, source_row_hash, local_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, seq`,
    [
      p.productId,
      p.type,
      signed.toString(),
      p.occurredOn,
      periodId,
      p.unitCostSatang ?? null,
      p.sourceKind,
      p.sourceId ?? null,
      p.sourceRowHash ?? null,
      p.localId ?? null,
    ],
  );
  const { id: movementId, seq } = inserted.rows[0]!;
  const seqNum = Number(seq);

  const ledgerMovement: LedgerMovement = {
    type: p.type,
    quantity: signed.toString(),
    unitCostSatang: p.unitCostSatang ?? null,
  };
  const step = costStep(state, ledgerMovement);
  await writeCostState(tx, p.productId, step.state, seqNum);

  return {
    movementId,
    seq: seqNum,
    qtyBefore: state.qtyOnHand.toString(),
    qtyAfter: step.state.qtyOnHand.toString(),
    avgCostMicroAfter: step.state.avgCostMicro,
    totalCostSatangAfter: step.state.totalCostSatang,
    cogsSatang: step.cogsSatang,
    costBasisReset: step.reset,
  };
}

/** Replay a product's ACTIVE ledger without writing (spec §9.4). Used by reconciliation. */
export async function replayProductState(
  db: Queryable,
  productId: string,
): Promise<{ state: CostState; maxSeq: number }> {
  const { rows } = await db.query<{
    type: MovementType;
    quantity: string;
    unit_cost_satang: string | null;
    status: 'ACTIVE' | 'VOIDED';
  }>(
    `SELECT type, quantity, unit_cost_satang, status
     FROM movements WHERE product_id = $1 ORDER BY occurred_on, seq`,
    [productId],
  );
  const movements: LedgerMovement[] = rows.map((r) => ({
    type: r.type,
    quantity: r.quantity,
    unitCostSatang: r.unit_cost_satang != null ? Number(r.unit_cost_satang) : null,
    status: r.status,
  }));
  const maxSeqRes = await db.query<{ s: string | null }>(
    'SELECT max(seq)::text AS s FROM movements WHERE product_id = $1',
    [productId],
  );
  return { state: replayLedger(movements), maxSeq: Number(maxSeqRes.rows[0]?.s ?? 0) };
}

/** Rebuild stock_state for one product from its ACTIVE ledger (spec §9.4). */
export async function recomputeStockState(tx: Queryable, productId: string): Promise<CostState> {
  const { state, maxSeq } = await replayProductState(tx, productId);
  await writeCostState(tx, productId, state, maxSeq);
  return state;
}

const DOC_TABLE = {
  purchase: 'purchases',
  sale: 'sales',
  return: 'returns',
  adjustment: 'adjustments',
} as const;

export async function voidDocumentTx(
  tx: Queryable,
  kind: keyof typeof DOC_TABLE,
  id: string,
  reason: string,
): Promise<{ productId: string; occurredOn: string }> {
  const table = DOC_TABLE[kind];
  const doc = await tx.query<{ product_id: string; occurred_on: string; status: string }>(
    `SELECT product_id, occurred_on, status FROM ${table} WHERE id = $1`,
    [id],
  );
  if (!doc.rows[0]) throw new AppError('NOT_FOUND');
  if (doc.rows[0].status === 'VOIDED') throw new AppError('ALREADY_VOIDED');
  const productId = doc.rows[0].product_id;
  const occurredOn = doc.rows[0].occurred_on;

  await assertPeriodOpen(tx, occurredOn);
  await advisoryXactLock(tx, productId);

  await tx.query(
    `UPDATE ${table} SET status='VOIDED', voided_at=now(), void_reason=$2 WHERE id=$1`,
    [id, reason],
  );
  const srcKind = kind === 'purchase' ? 'PURCHASE' : kind === 'sale' ? 'SALE' : kind === 'return' ? 'RETURN' : 'ADJUSTMENT';
  await tx.query(
    `UPDATE movements SET status='VOIDED', voided_at=now(), void_reason=$3
     WHERE source_kind=$1 AND source_id=$2`,
    [srcKind, id, reason],
  );

  await recomputeStockState(tx, productId);
  return { productId, occurredOn };
}

export interface LedgerPageRow {
  id: string;
  seq: number;
  type: MovementType;
  quantity: string;
  occurredOn: string;
  status: 'ACTIVE' | 'VOIDED';
  voidReason: string | null;
  unitCostSatang: number | null;
  runningBalance: string;
}

export async function getLedger(
  db: Queryable,
  productId: string,
  opts: { page?: number; pageSize?: number; includeVoided?: boolean } = {},
): Promise<{
  rows: LedgerPageRow[];
  openingBalance: string;
  page: number;
  pageSize: number;
  total: number;
  currentStock: string;
}> {
  const page = opts.page ?? 1;
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const includeVoided = opts.includeVoided ?? true;
  const offset = (page - 1) * pageSize;
  const voidedFilter = includeVoided ? '' : `AND status = 'ACTIVE'`;

  const totalRes = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM movements WHERE product_id = $1 ${voidedFilter}`,
    [productId],
  );
  const total = Number(totalRes.rows[0]?.n ?? 0);

  const pageRes = await db.query<{
    id: string;
    seq: string;
    type: MovementType;
    quantity: string;
    occurred_on: string;
    status: 'ACTIVE' | 'VOIDED';
    void_reason: string | null;
    unit_cost_satang: string | null;
  }>(
    `SELECT id, seq, type, quantity, occurred_on, status, void_reason, unit_cost_satang
     FROM movements WHERE product_id = $1 ${voidedFilter}
     ORDER BY occurred_on, seq
     LIMIT $2 OFFSET $3`,
    [productId, pageSize, offset],
  );

  // opening balance = sum of ACTIVE quantity strictly before the first row on this page
  let openingBalance = '0';
  if (pageRes.rows[0]) {
    const first = pageRes.rows[0];
    const openingRes = await db.query<{ s: string | null }>(
      `SELECT COALESCE(sum(quantity), 0)::text AS s FROM movements
       WHERE product_id = $1 AND status = 'ACTIVE'
         AND (occurred_on, seq) < ($2::date, $3::bigint)`,
      [productId, first.occurred_on, first.seq],
    );
    openingBalance = new Decimal(openingRes.rows[0]?.s ?? '0').toString();
  }
  let running = new Decimal(openingBalance);

  const rows: LedgerPageRow[] = pageRes.rows.map((r) => {
    if (r.status === 'ACTIVE') running = running.plus(new Decimal(r.quantity));
    return {
      id: r.id,
      seq: Number(r.seq),
      type: r.type,
      quantity: new Decimal(r.quantity).toString(),
      occurredOn: r.occurred_on,
      status: r.status,
      voidReason: r.void_reason,
      unitCostSatang: r.unit_cost_satang != null ? Number(r.unit_cost_satang) : null,
      runningBalance: running.toString(),
    };
  });

  const stockRes = await db.query<{ q: string }>(
    'SELECT COALESCE(qty_on_hand, 0)::text AS q FROM stock_state WHERE product_id = $1',
    [productId],
  );

  return {
    rows,
    openingBalance,
    page,
    pageSize,
    total,
    currentStock: new Decimal(stockRes.rows[0]?.q ?? '0').toString(),
  };
}

/**
 * 68/69 view for one product against the current fiscal year (spec §5.3, §6.5).
 * "Stock 68" is the closing position at the start of the CFY: every OPENING movement
 * plus the net of anything dated before the CFY start. Before the first rollover this
 * equals the sum of OPENING movements; after a rollover it becomes the prior year's
 * closing balance without any snapshot table.
 */
export async function currentFyView(
  db: Queryable,
  productId: string,
  currentFiscalYear: number,
): Promise<{ stock68: string; purchasesCfy: string; salesCfy: string; variance: string }> {
  const gregYear = currentFiscalYear - 543;
  const cfyStart = `${gregYear}-01-01`;
  const { rows } = await db.query<{
    opening: string;
    purchases: string;
    sales: string;
  }>(
    `SELECT
       COALESCE(sum(quantity) FILTER (WHERE type = 'OPENING'
                 OR occurred_on < $3::date), 0)::text                   AS opening,
       COALESCE(sum(quantity) FILTER (WHERE type = 'PURCHASE'
                 AND extract(year FROM occurred_on) = $2), 0)::text     AS purchases,
       COALESCE(-sum(quantity) FILTER (WHERE type = 'SALE'
                 AND extract(year FROM occurred_on) = $2), 0)::text     AS sales
     FROM movements
     WHERE product_id = $1 AND status = 'ACTIVE'`,
    [productId, gregYear, cfyStart],
  );
  const r = rows[0]!;
  const purchases = new Decimal(r.purchases);
  const sales = new Decimal(r.sales);
  return {
    stock68: new Decimal(r.opening).toString(),
    purchasesCfy: purchases.toString(),
    salesCfy: sales.toString(),
    variance: purchases.minus(sales).toString(),
  };
}
