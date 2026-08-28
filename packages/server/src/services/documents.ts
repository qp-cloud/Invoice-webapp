import { randomUUID } from 'node:crypto';
import {
  AppError,
  asSatang,
  type CreateAdjustmentInput,
  type CreatePurchaseInput,
  type CreateReturnInput,
  type CreateSaleInput,
  Decimal,
  multiplySatang,
} from '@inventory/shared';
import type { Database, Queryable } from '../db/client.js';
import { writeAudit } from './audit.js';
import { checkBackdate } from './backdate.js';
import { type IdempotentResult, isUniqueViolation, runIdempotent } from './idempotency.js';
import { postMovementTx, recomputeStockState, voidDocumentTx } from './ledger.js';
import { getNegativeStockMode } from './settings.js';

const total = (unitSatang: number, quantity: string): number =>
  multiplySatang(asSatang(unitSatang), quantity);

/** Adjustment reason codes that post a DAMAGE movement instead of ADJUSTMENT (spec §10.4). */
const DAMAGE_REASONS = new Set(['DAMAGED']);

function conflictOnDup(err: unknown): never {
  if (isUniqueViolation(err)) throw new AppError('CONFLICT', { userMessage: 'รายการซ้ำ' });
  throw err;
}

// ---------------------------------------------------------------- purchase

export function createPurchase(
  db: Database,
  key: string,
  input: CreatePurchaseInput,
): Promise<IdempotentResult<unknown>> {
  return runIdempotent(db, { key, endpoint: 'POST /purchases', body: input }, async (tx) => {
    const bd = await checkBackdate(tx, input.occurredOn, input.backdateReason);
    const mode = await getNegativeStockMode(tx);
    const id = randomUUID();
    const totalCost = total(input.unitCostSatang, input.quantity);
    try {
      await tx.query(
        `INSERT INTO purchases
           (id, occurred_on, product_id, quantity, unit_cost_satang, total_cost_satang,
            invoice_no, supplier, note, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id, input.occurredOn, input.productId, input.quantity, input.unitCostSatang,
          totalCost, input.invoiceNo ?? null, input.supplier ?? null, input.note ?? null, key,
        ],
      );
    } catch (err) {
      conflictOnDup(err);
    }
    const mv = await postMovementTx(tx, {
      productId: input.productId, type: 'PURCHASE', occurredOn: input.occurredOn,
      quantityMagnitude: input.quantity, unitCostSatang: input.unitCostSatang,
      sourceKind: 'PURCHASE', sourceId: id, negativeStockMode: mode,
    });
    await writeAudit(tx, {
      action: 'CREATE', entity: 'purchase', entityId: id,
      newValue: { quantity: input.quantity, unitCostSatang: input.unitCostSatang, totalCost },
      reason: bd.backdated ? (input.backdateReason ?? 'backdated') : null,
    });
    return {
      statusCode: 201,
      body: {
        id, totalCostSatang: totalCost, movementId: mv.movementId,
        stockAfter: { qtyOnHand: mv.qtyAfter, avgCostSatang: Math.round(mv.avgCostMicroAfter / 10_000) },
        warnings: bd.warnings,
      },
    };
  });
}

// ---------------------------------------------------------------- sale

export function createSale(
  db: Database,
  key: string,
  input: CreateSaleInput,
): Promise<IdempotentResult<unknown>> {
  return runIdempotent(db, { key, endpoint: 'POST /sales', body: input }, async (tx) => {
    const bd = await checkBackdate(tx, input.occurredOn, input.backdateReason);
    const mode = await getNegativeStockMode(tx);
    const id = randomUUID();
    const totalPrice = total(input.unitPriceSatang, input.quantity);
    try {
      await tx.query(
        `INSERT INTO sales
           (id, occurred_on, product_id, quantity, unit_price_satang, total_price_satang,
            bill_no, channel, note, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id, input.occurredOn, input.productId, input.quantity, input.unitPriceSatang,
          totalPrice, input.billNo ?? null, input.channel ?? null, input.note ?? null, key,
        ],
      );
    } catch (err) {
      conflictOnDup(err);
    }
    const mv = await postMovementTx(tx, {
      productId: input.productId, type: 'SALE', occurredOn: input.occurredOn,
      quantityMagnitude: input.quantity, sourceKind: 'SALE', sourceId: id, negativeStockMode: mode,
    });
    await tx.query('UPDATE sales SET cogs_satang = $2 WHERE id = $1', [id, mv.cogsSatang]);
    await writeAudit(tx, {
      action: 'CREATE', entity: 'sale', entityId: id,
      newValue: {
        quantity: input.quantity, unitPriceSatang: input.unitPriceSatang,
        totalPrice, cogsSatang: mv.cogsSatang,
      },
      reason: bd.backdated ? (input.backdateReason ?? 'backdated') : null,
    });
    const oversold = new Decimal(mv.qtyAfter).lt(0);
    return {
      statusCode: 201,
      body: {
        id, totalPriceSatang: totalPrice, cogsSatang: mv.cogsSatang, movementId: mv.movementId,
        stockAfter: { qtyOnHand: mv.qtyAfter }, oversold,
        missingBalance: oversold ? new Decimal(mv.qtyAfter).abs().toString() : '0',
        warnings: bd.warnings,
      },
    };
  });
}

// ---------------------------------------------------------------- return

export function createReturn(
  db: Database,
  key: string,
  input: CreateReturnInput,
): Promise<IdempotentResult<unknown>> {
  return runIdempotent(db, { key, endpoint: 'POST /returns', body: input }, async (tx) => {
    const bd = await checkBackdate(tx, input.occurredOn, input.backdateReason);
    const mode = await getNegativeStockMode(tx);
    const id = randomUUID();
    const isCustomer = input.kind === 'CUSTOMER';
    try {
      await tx.query(
        `INSERT INTO returns
           (id, kind, occurred_on, product_id, quantity, unit_cost_satang,
            linked_sale_id, linked_purchase_id, reason, note, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id, input.kind, input.occurredOn, input.productId, input.quantity,
          isCustomer ? input.unitCostSatang : null,
          input.linkedSaleId ?? null, input.linkedPurchaseId ?? null,
          input.reason ?? null, input.note ?? null, key,
        ],
      );
    } catch (err) {
      conflictOnDup(err);
    }
    const mv = await postMovementTx(tx, {
      productId: input.productId,
      type: isCustomer ? 'CUSTOMER_RETURN' : 'SUPPLIER_RETURN',
      occurredOn: input.occurredOn, quantityMagnitude: input.quantity,
      unitCostSatang: isCustomer ? input.unitCostSatang : null,
      sourceKind: 'RETURN', sourceId: id, negativeStockMode: mode,
    });
    await writeAudit(tx, {
      action: 'CREATE', entity: 'return', entityId: id,
      newValue: { kind: input.kind, quantity: input.quantity, unitCostSatang: input.unitCostSatang ?? null },
      reason: bd.backdated ? (input.backdateReason ?? 'backdated') : null,
    });
    return {
      statusCode: 201,
      body: { id, movementId: mv.movementId, stockAfter: { qtyOnHand: mv.qtyAfter }, warnings: bd.warnings },
    };
  });
}

// ---------------------------------------------------------------- adjustment

export function createAdjustment(
  db: Database,
  key: string,
  input: CreateAdjustmentInput,
): Promise<IdempotentResult<unknown>> {
  return runIdempotent(db, { key, endpoint: 'POST /adjustments', body: input }, async (tx) => {
    const bd = await checkBackdate(tx, input.occurredOn, input.backdateReason);
    const mode = await getNegativeStockMode(tx);
    const id = randomUUID();
    const isNegative = input.quantityDelta.startsWith('-');
    try {
      await tx.query(
        `INSERT INTO adjustments
           (id, occurred_on, product_id, quantity_delta, reason_code, unit_cost_satang, note, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id, input.occurredOn, input.productId, input.quantityDelta, input.reasonCode,
          isNegative ? null : (input.unitCostSatang ?? null), input.note ?? null, key,
        ],
      );
    } catch (err) {
      conflictOnDup(err);
    }

    const asDamage = DAMAGE_REASONS.has(input.reasonCode) && isNegative;
    const before = await tx.query<{ q: string }>(
      'SELECT qty_on_hand::text AS q FROM stock_state WHERE product_id = $1',
      [input.productId],
    );
    const mv = asDamage
      ? await postMovementTx(tx, {
          productId: input.productId, type: 'DAMAGE', occurredOn: input.occurredOn,
          quantityMagnitude: input.quantityDelta.replace('-', ''),
          sourceKind: 'ADJUSTMENT', sourceId: id, negativeStockMode: mode,
        })
      : await postMovementTx(tx, {
          productId: input.productId, type: 'ADJUSTMENT', occurredOn: input.occurredOn,
          signedDelta: input.quantityDelta,
          unitCostSatang: isNegative ? null : (input.unitCostSatang ?? null),
          sourceKind: 'ADJUSTMENT', sourceId: id, negativeStockMode: mode,
        });

    await writeAudit(tx, {
      action: 'CREATE', entity: 'adjustment', entityId: id,
      oldValue: { qtyOnHand: before.rows[0]?.q ?? '0' },
      newValue: {
        qtyOnHand: mv.qtyAfter, reasonCode: input.reasonCode,
        posted: asDamage ? 'DAMAGE' : 'ADJUSTMENT',
      },
      reason: bd.backdated ? (input.backdateReason ?? 'backdated') : null,
    });
    if (mv.costBasisReset) {
      await writeAudit(tx, {
        action: 'COST_BASIS_RESET', entity: 'product', entityId: input.productId,
        newValue: { avgCostMicro: mv.avgCostMicroAfter, trigger: 'adjustment', movementId: mv.movementId },
      });
    }
    return {
      statusCode: 201,
      body: { id, movementId: mv.movementId, stockAfter: { qtyOnHand: mv.qtyAfter }, warnings: bd.warnings },
    };
  });
}

// ---------------------------------------------------------------- opening

export function createOpening(
  db: Database,
  key: string,
  input: { productId: string; quantity: string; unitCostSatang: number; occurredOn: string },
): Promise<IdempotentResult<unknown>> {
  return runIdempotent(db, { key, endpoint: 'POST /openings', body: input }, async (tx) => {
    const mode = await getNegativeStockMode(tx);
    const existing = await tx.query<{ id: string; type: string; status: string }>(
      `SELECT id, type, status FROM movements WHERE product_id = $1`,
      [input.productId],
    );
    const active = existing.rows.filter((r) => r.status === 'ACTIVE');
    const hasOpening = active.some((r) => r.type === 'OPENING');
    const hasOther = active.some((r) => r.type !== 'OPENING');

    if (hasOpening && hasOther) {
      throw new AppError('OPENING_LOCKED', {
        userMessage: 'มีความเคลื่อนไหวอื่นแล้ว ใช้การปรับปรุงสต็อกแทน',
      });
    }
    if (hasOpening) {
      // pristine: void the old OPENING, then rebuild the cache to zero (spec §13.8)
      await tx.query(
        `UPDATE movements SET status='VOIDED', voided_at=now(), void_reason='ตั้งยอดยกมาใหม่'
         WHERE product_id=$1 AND type='OPENING' AND status='ACTIVE'`,
        [input.productId],
      );
      await recomputeStockState(tx, input.productId);
    }
    const mv = await postMovementTx(tx, {
      productId: input.productId, type: 'OPENING', occurredOn: input.occurredOn,
      quantityMagnitude: input.quantity, unitCostSatang: input.unitCostSatang,
      sourceKind: 'OPENING', sourceId: null, negativeStockMode: mode,
    });
    await writeAudit(tx, {
      action: hasOpening ? 'UPDATE' : 'CREATE', entity: 'movement', entityId: mv.movementId,
      newValue: { type: 'OPENING', quantity: input.quantity, unitCostSatang: input.unitCostSatang },
    });
    return {
      statusCode: 201,
      body: { movementId: mv.movementId, stockAfter: { qtyOnHand: mv.qtyAfter } },
    };
  });
}

// ---------------------------------------------------------------- void

export function voidDocument(
  db: Database,
  key: string,
  input: { kind: 'purchase' | 'sale' | 'return' | 'adjustment'; id: string; reason: string },
): Promise<IdempotentResult<unknown>> {
  return runIdempotent(
    db,
    { key, endpoint: `POST /documents/${input.id}/void`, body: input },
    async (tx: Queryable) => {
      const { productId } = await voidDocumentTx(tx, input.kind, input.id, input.reason);
      await writeAudit(tx, {
        action: 'VOID', entity: input.kind, entityId: input.id,
        oldValue: { status: 'ACTIVE' }, newValue: { status: 'VOIDED' }, reason: input.reason,
      });
      const stock = await tx.query<{ q: string }>(
        'SELECT qty_on_hand::text AS q FROM stock_state WHERE product_id = $1',
        [productId],
      );
      return {
        statusCode: 200,
        body: { id: input.id, status: 'VOIDED', productId, stockAfter: { qtyOnHand: stock.rows[0]?.q ?? '0' } },
      };
    },
  );
}
