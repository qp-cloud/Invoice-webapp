import { Decimal } from '@inventory/shared';
import type { Queryable } from '../db/client.js';
import { getCurrentFiscalYear } from './settings.js';

export interface DashboardPayload {
  fiscalYear: number;
  stock68Qty: string;
  purchasesCfyQty: string;
  purchasesCfyValueSatang: number;
  salesCfyQty: string;
  salesRevenueSatang: number;
  currentStockQty: string;
  estimatedCogsSatang: number;
  estimatedGrossProfitSatang: number;
  oversoldSkuCount: number;
  lowStockSkuCount: number;
  asOf: string;
}

/**
 * Spec §18.1 KPI payload. Every figure is aggregated in SQL — the client never sums
 * over history. Quantities come from the ACTIVE movement ledger; money comes from the
 * ACTIVE document rows (already rounded at post time).
 */
export async function getDashboard(db: Queryable): Promise<DashboardPayload> {
  const fiscalYear = await getCurrentFiscalYear(db);
  const gregYear = fiscalYear - 543;

  const mv = await db.query<{
    stock68: string;
    purchases_qty: string;
    sales_qty: string;
  }>(
    `SELECT
       COALESCE(sum(quantity) FILTER (WHERE type = 'OPENING'), 0)::text  AS stock68,
       COALESCE(sum(quantity) FILTER (WHERE type = 'PURCHASE'
                 AND extract(year FROM occurred_on) = $1), 0)::text      AS purchases_qty,
       COALESCE(-sum(quantity) FILTER (WHERE type = 'SALE'
                 AND extract(year FROM occurred_on) = $1), 0)::text      AS sales_qty
     FROM movements
     WHERE status = 'ACTIVE'`,
    [gregYear],
  );

  const purch = await db.query<{ value: string }>(
    `SELECT COALESCE(sum(total_cost_satang), 0)::text AS value
     FROM purchases
     WHERE status = 'ACTIVE' AND extract(year FROM occurred_on) = $1`,
    [gregYear],
  );

  const sale = await db.query<{ revenue: string; cogs: string }>(
    `SELECT COALESCE(sum(total_price_satang), 0)::text AS revenue,
            COALESCE(sum(cogs_satang), 0)::text        AS cogs
     FROM sales
     WHERE status = 'ACTIVE' AND extract(year FROM occurred_on) = $1`,
    [gregYear],
  );

  const stock = await db.query<{ total: string }>(
    `SELECT COALESCE(sum(qty_on_hand), 0)::text AS total FROM stock_state`,
  );

  const counts = await db.query<{ oversold: string; low: string }>(
    `SELECT
       count(*) FILTER (WHERE ss.qty_on_hand < 0)::text                                   AS oversold,
       count(*) FILTER (WHERE ss.qty_on_hand >= 0 AND ss.qty_on_hand <= p.min_stock)::text AS low
     FROM products p
     JOIN stock_state ss ON ss.product_id = p.id
     WHERE p.active = true`,
  );

  const revenue = Number(sale.rows[0]?.revenue ?? 0);
  const cogs = Number(sale.rows[0]?.cogs ?? 0);

  return {
    fiscalYear,
    stock68Qty: new Decimal(mv.rows[0]?.stock68 ?? '0').toString(),
    purchasesCfyQty: new Decimal(mv.rows[0]?.purchases_qty ?? '0').toString(),
    purchasesCfyValueSatang: Number(purch.rows[0]?.value ?? 0),
    salesCfyQty: new Decimal(mv.rows[0]?.sales_qty ?? '0').toString(),
    salesRevenueSatang: revenue,
    currentStockQty: new Decimal(stock.rows[0]?.total ?? '0').toString(),
    estimatedCogsSatang: cogs,
    estimatedGrossProfitSatang: revenue - cogs,
    oversoldSkuCount: Number(counts.rows[0]?.oversold ?? 0),
    lowStockSkuCount: Number(counts.rows[0]?.low ?? 0),
    asOf: new Date().toISOString(),
  };
}
