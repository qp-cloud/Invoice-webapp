import { Decimal } from '@inventory/shared';
import type { Database } from '../db/client.js';
import { writeAudit } from './audit.js';
import { recomputeStockState, replayProductState } from './ledger.js';
import { getSetting } from './settings.js';

export interface Mismatch {
  productId: string;
  sku: string;
  field: 'qtyOnHand' | 'totalCostSatang' | 'avgCostMicro';
  cached: string;
  computed: string;
}

export interface ReconcileResult {
  checkedProducts: number;
  mismatches: Mismatch[];
  healed: string[];
  autoHeal: boolean;
}

/**
 * Replay every product's ACTIVE ledger and compare against the `stock_state` cache
 * (spec §21). Reports every drift; with `autoHeal` (default = `settings.recon_autoheal`)
 * it rewrites the cache from the ledger, which is always the source of truth.
 */
export async function reconcile(
  db: Database,
  opts: { autoHeal?: boolean } = {},
): Promise<ReconcileResult> {
  const autoHeal =
    opts.autoHeal ?? Boolean(await getSetting<boolean>(db, 'recon_autoheal').catch(() => true));

  const products = await db.query<{ id: string; sku: string }>(
    `SELECT p.id, p.sku FROM products p ORDER BY p.sku`,
  );

  const mismatches: Mismatch[] = [];
  const healedSet = new Set<string>();

  for (const p of products.rows) {
    const cacheRes = await db.query<{
      qty_on_hand: string | null;
      total_cost_satang: string | null;
      avg_cost_micro: string | null;
    }>(
      `SELECT qty_on_hand, total_cost_satang, avg_cost_micro FROM stock_state WHERE product_id = $1`,
      [p.id],
    );
    const { state } = await replayProductState(db, p.id);

    const cache = cacheRes.rows[0] ?? { qty_on_hand: null, total_cost_satang: null, avg_cost_micro: null };
    const checks: [Mismatch['field'], string, string][] = [
      ['qtyOnHand', new Decimal(cache.qty_on_hand ?? '0').toString(), state.qtyOnHand.toString()],
      ['totalCostSatang', String(Number(cache.total_cost_satang ?? 0)), String(state.totalCostSatang)],
      ['avgCostMicro', String(Number(cache.avg_cost_micro ?? 0)), String(state.avgCostMicro)],
    ];
    let drifted = false;
    for (const [field, cached, computed] of checks) {
      if (cached !== computed) {
        drifted = true;
        mismatches.push({ productId: p.id, sku: p.sku, field, cached, computed });
      }
    }
    if (drifted && autoHeal) {
      await db.transaction(async (tx) => {
        await recomputeStockState(tx, p.id);
      });
      healedSet.add(p.id);
    }
  }

  if (mismatches.length > 0) {
    await writeAudit(db, {
      action: 'UPDATE',
      entity: 'reconcile',
      entityId: new Date().toISOString(),
      newValue: {
        checkedProducts: products.rows.length,
        mismatchCount: mismatches.length,
        healed: [...healedSet],
        autoHeal,
      },
    });
  }

  return {
    checkedProducts: products.rows.length,
    mismatches,
    healed: [...healedSet],
    autoHeal,
  };
}
