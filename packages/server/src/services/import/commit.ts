import { randomUUID } from 'node:crypto';
import { AppError, asSatang, Decimal, multiplySatang } from '@inventory/shared';
import type { Database, Queryable } from '../../db/client.js';
import { writeAudit } from '../audit.js';
import { type IdempotentResult, runIdempotent } from '../idempotency.js';
import { postMovementTx, recomputeStockState } from '../ledger.js';
import { getNegativeStockMode } from '../settings.js';
import type { ImportKind } from './headers.js';

export type CommitMode = 'ALL_OR_NOTHING' | 'PARTIAL';

interface DbRow {
  row_no: number;
  action: 'CREATE' | 'UPDATE' | 'SKIP' | 'DUPLICATE';
  sanitized: Record<string, unknown> | null;
  source_row_hash: string;
}

export interface CommitResult {
  status: 'COMMITTED' | 'FAILED';
  committedRows: number;
  skippedRows: number;
  createdProducts: number;
  updatedProducts: number;
  movementsCreated: number;
  error: string | null;
}

const totalSatang = (unit: number, qty: string): number => multiplySatang(asSatang(unit), qty);

async function upsertProduct(
  tx: Queryable,
  s: Record<string, unknown>,
): Promise<{ id: string; created: boolean }> {
  const sku = String(s.sku);
  const knownUnit = s.unit
    ? (await tx.query('SELECT 1 FROM units WHERE code = $1', [String(s.unit)])).rows.length > 0
      ? String(s.unit)
      : null
    : null;

  const found = await tx.query<{ id: string }>('SELECT id FROM products WHERE sku = $1', [sku]);
  if (found.rows[0]) {
    const id = found.rows[0].id;
    await tx.query(
      `UPDATE products
       SET name = COALESCE(NULLIF($2, ''), name),
           unit_code = COALESCE($3, unit_code),
           min_stock = COALESCE($4, min_stock),
           updated_at = now()
       WHERE id = $1`,
      [id, String(s.name ?? ''), knownUnit, s.min_stock ?? null],
    );
    return { id, created: false };
  }
  // Unknown unit labels (typos, Thai words not yet in `units`) fall back to 'piece' —
  // the unit is cosmetic for stock math and the owner can fix it later. The preview
  // still surfaces an UNKNOWN_UNIT warning for these rows.
  const unit = knownUnit ?? 'piece';
  const id = randomUUID();
  await tx.query(
    `INSERT INTO products (id, sku, name, unit_code, min_stock)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, sku, String(s.name ?? sku), unit, String(s.min_stock ?? '0')],
  );
  await tx.query('INSERT INTO stock_state (product_id) VALUES ($1)', [id]);
  return { id, created: true };
}

/** Master Stock 68 re-import effect (spec §13.8, IMPORT_FORMAT.md §2). Returns movements added. */
async function applyOpening(
  tx: Queryable,
  productId: string,
  targetQty: string,
  occurredOn: string,
  mode: 'ALLOW' | 'PREVENT',
  unitCostSatang = 0,
): Promise<number> {
  const mv = await tx.query<{ type: string; status: string }>(
    `SELECT type, status FROM movements WHERE product_id = $1`,
    [productId],
  );
  const active = mv.rows.filter((r) => r.status === 'ACTIVE');
  const pristine =
    active.length === 1 && active[0]!.type === 'OPENING';

  if (active.length === 0 || pristine) {
    if (pristine) {
      await tx.query(
        `UPDATE movements SET status='VOIDED', voided_at=now(), void_reason='นำเข้ายอดยกมาใหม่'
         WHERE product_id=$1 AND type='OPENING' AND status='ACTIVE'`,
        [productId],
      );
      await recomputeStockState(tx, productId);
    }
    await postMovementTx(tx, {
      productId, type: 'OPENING', occurredOn, quantityMagnitude: targetQty,
      unitCostSatang, sourceKind: 'OPENING', negativeStockMode: mode,
    });
    return 1;
  }

  // otherwise: ADJUSTMENT for the difference, reason CORRECTION
  const cur = await tx.query<{ q: string; avg: string }>(
    `SELECT qty_on_hand::text AS q, avg_cost_micro::text AS avg FROM stock_state WHERE product_id = $1`,
    [productId],
  );
  const delta = new Decimal(targetQty).minus(new Decimal(cur.rows[0]?.q ?? '0'));
  if (delta.isZero()) return 0;

  const positive = delta.gt(0);
  const avgSatang = Math.round(Number(cur.rows[0]?.avg ?? 0) / 10_000);
  const unitCost = positive ? avgSatang : null;
  const adjId = randomUUID();
  await tx.query(
    `INSERT INTO adjustments (id, occurred_on, product_id, quantity_delta, reason_code, unit_cost_satang, idempotency_key)
     VALUES ($1,$2,$3,$4,'CORRECTION',$5,$6)`,
    [adjId, occurredOn, productId, delta.toString(), unitCost, randomUUID()],
  );
  await postMovementTx(tx, {
    productId, type: 'ADJUSTMENT', occurredOn, signedDelta: delta.toString(),
    unitCostSatang: unitCost, sourceKind: 'ADJUSTMENT', sourceId: adjId, negativeStockMode: mode,
  });
  return 1;
}

/** DB TRANSACTION -> COMMIT (spec §13.3). One transaction; ALL_OR_NOTHING rolls back on any error. */
export function commitImport(
  db: Database,
  batchId: string,
  opts: { mode: CommitMode; acknowledgeDuplicateFile?: boolean },
  idempotencyKey: string,
): Promise<IdempotentResult<CommitResult>> {
  return runIdempotent<CommitResult>(
    db,
    { key: idempotencyKey, endpoint: `POST /imports/${batchId}/commit`, body: { batchId, ...opts } },
    async (tx) => {
      const b = await tx.query<{
        id: string; kind: ImportKind; status: string; source_file_hash: string;
      }>(`SELECT id, kind, status, source_file_hash FROM import_batches WHERE id = $1 FOR UPDATE`, [batchId]);
      if (!b.rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบรายการนำเข้า' });
      const batch = b.rows[0];
      if (batch.status !== 'PREVIEW') {
        throw new AppError('CONFLICT', { userMessage: `นำเข้าไม่ได้ สถานะ ${batch.status}` });
      }

      const dupFile = await tx.query(
        `SELECT 1 FROM import_batches
         WHERE source_file_hash = $1 AND status = 'COMMITTED' AND id <> $2 LIMIT 1`,
        [batch.source_file_hash, batchId],
      );
      if (dupFile.rows.length > 0 && !opts.acknowledgeDuplicateFile) {
        throw new AppError('IMPORT_FILE_ALREADY_IMPORTED');
      }

      const rowsRes = await tx.query<DbRow>(
        `SELECT row_no, action, sanitized, source_row_hash FROM import_rows
         WHERE batch_id = $1
         ORDER BY (sanitized->>'date') NULLS FIRST, row_no`,
        [batchId],
      );
      const rows = rowsRes.rows;

      if (opts.mode === 'ALL_OR_NOTHING' && rows.some((r) => r.action === 'SKIP')) {
        throw new AppError('IMPORT_HAS_INVALID_ROWS', {
          details: { invalidRows: rows.filter((r) => r.action === 'SKIP').map((r) => r.row_no) },
        });
      }

      const mode = await getNegativeStockMode(tx);
      let committedRows = 0;
      let skippedRows = 0;
      let createdProducts = 0;
      let updatedProducts = 0;
      let movementsCreated = 0;

      for (const r of rows) {
        if (r.action === 'DUPLICATE' || r.action === 'SKIP' || !r.sanitized) {
          skippedRows += 1;
          continue;
        }
        const s = r.sanitized;

        if (batch.kind === 'MASTER_STOCK') {
          const { id, created } = await upsertProduct(tx, s);
          if (created) createdProducts += 1;
          else updatedProducts += 1;
          const today = new Date().toISOString().slice(0, 10);
          const openingCost = s.unit_cost != null ? Number(s.unit_cost) : 0;
          movementsCreated += await applyOpening(tx, id, String(s.stock_68), today, mode, openingCost);
        } else if (batch.kind === 'PURCHASES') {
          const prod = await tx.query<{ id: string }>('SELECT id FROM products WHERE sku = $1', [s.sku]);
          const productId = prod.rows[0]!.id;
          const unitCost = Number(s.unit_cost);
          const docId = randomUUID();
          await tx.query(
            `INSERT INTO purchases
               (id, occurred_on, product_id, quantity, unit_cost_satang, total_cost_satang,
                invoice_no, supplier, note, idempotency_key, import_batch_id, source_row_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              docId, s.date, productId, s.quantity, unitCost, totalSatang(unitCost, String(s.quantity)),
              s.invoice_no ?? null, s.supplier ?? null, s.note ?? null, randomUUID(), batchId, r.source_row_hash,
            ],
          );
          await postMovementTx(tx, {
            productId, type: 'PURCHASE', occurredOn: String(s.date),
            quantityMagnitude: String(s.quantity), unitCostSatang: unitCost,
            sourceKind: 'PURCHASE', sourceId: docId, sourceRowHash: r.source_row_hash,
            negativeStockMode: mode,
          });
          movementsCreated += 1;
        } else {
          const prod = await tx.query<{ id: string }>('SELECT id FROM products WHERE sku = $1', [s.sku]);
          const productId = prod.rows[0]!.id;
          const price = Number(s.selling_price);
          const docId = randomUUID();
          await tx.query(
            `INSERT INTO sales
               (id, occurred_on, product_id, quantity, unit_price_satang, total_price_satang,
                bill_no, channel, note, idempotency_key, import_batch_id, source_row_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              docId, s.date, productId, s.quantity, price, totalSatang(price, String(s.quantity)),
              s.bill_no ?? null, s.channel ?? null, s.note ?? null, randomUUID(), batchId, r.source_row_hash,
            ],
          );
          const mv = await postMovementTx(tx, {
            productId, type: 'SALE', occurredOn: String(s.date),
            quantityMagnitude: String(s.quantity), sourceKind: 'SALE', sourceId: docId,
            sourceRowHash: r.source_row_hash, negativeStockMode: mode,
          });
          await tx.query('UPDATE sales SET cogs_satang = $2 WHERE id = $1', [docId, mv.cogsSatang]);
          movementsCreated += 1;
        }

        await tx.query(`UPDATE import_rows SET committed = true WHERE batch_id = $1 AND row_no = $2`, [
          batchId, r.row_no,
        ]);
        committedRows += 1;
      }

      await tx.query(
        `UPDATE import_batches
         SET status = 'COMMITTED', committed_at = now(), mode = $2,
             valid_count = $3, invalid_count = $4
         WHERE id = $1`,
        [batchId, opts.mode, committedRows, skippedRows],
      );
      await writeAudit(tx, {
        action: 'IMPORT_COMMIT',
        entity: 'import_batch',
        entityId: batchId,
        newValue: { kind: batch.kind, mode: opts.mode, committedRows, skippedRows, movementsCreated },
      });

      return {
        statusCode: 200,
        body: {
          status: 'COMMITTED',
          committedRows,
          skippedRows,
          createdProducts,
          updatedProducts,
          movementsCreated,
          error: null,
        },
      };
    },
  );
}
