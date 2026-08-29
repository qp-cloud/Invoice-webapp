import { Decimal } from '@inventory/shared';
import type { Queryable } from '../db/client.js';

function monthRange(ym: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) throw new Error(`expected YYYY-MM, got ${ym}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = `${ym}-01`;
  const end =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { start, end };
}

export interface MonthlyReportRow {
  productId: string;
  sku: string;
  name: string;
  openingQty: string;
  purchasesQty: string;
  purchasesValueSatang: number;
  salesQty: string;
  salesRevenueSatang: number;
  estimatedCogsSatang: number;
  estimatedGrossProfitSatang: number;
  grossMarginPct: number | null;
  closingQty: string;
}

export interface MonthlyReport {
  ym: string;
  rows: MonthlyReportRow[];
  totals: {
    purchasesValueSatang: number;
    salesRevenueSatang: number;
    estimatedCogsSatang: number;
    estimatedGrossProfitSatang: number;
    grossMarginPct: number | null;
  };
}

const marginPct = (gp: number, revenue: number): number | null =>
  revenue > 0 ? Number(((gp / revenue) * 100).toFixed(2)) : null;

/** Spec §9.5, API.md §7. Per-SKU opening / purchases / sales / COGS / closing for a month. */
export async function monthlyReport(db: Queryable, ym: string): Promise<MonthlyReport> {
  const { start, end } = monthRange(ym);

  const qtyRes = await db.query<{
    id: string;
    sku: string;
    name: string;
    opening: string;
    purchases_qty: string;
    sales_qty: string;
    closing: string;
  }>(
    `SELECT p.id, p.sku, p.name,
       COALESCE(sum(m.quantity) FILTER (
         WHERE m.status = 'ACTIVE' AND m.occurred_on < $1::date), 0)::text AS opening,
       COALESCE(sum(m.quantity) FILTER (
         WHERE m.status = 'ACTIVE' AND m.type = 'PURCHASE'
           AND m.occurred_on >= $1::date AND m.occurred_on < $2::date), 0)::text AS purchases_qty,
       COALESCE(-sum(m.quantity) FILTER (
         WHERE m.status = 'ACTIVE' AND m.type = 'SALE'
           AND m.occurred_on >= $1::date AND m.occurred_on < $2::date), 0)::text AS sales_qty,
       COALESCE(sum(m.quantity) FILTER (
         WHERE m.status = 'ACTIVE' AND m.occurred_on < $2::date), 0)::text AS closing
     FROM products p
     LEFT JOIN movements m ON m.product_id = p.id
     GROUP BY p.id, p.sku, p.name
     ORDER BY p.sku`,
    [start, end],
  );

  const purchByProduct = new Map<string, number>();
  const purch = await db.query<{ product_id: string; value: string }>(
    `SELECT product_id, COALESCE(sum(total_cost_satang), 0)::text AS value
     FROM purchases
     WHERE status = 'ACTIVE' AND occurred_on >= $1::date AND occurred_on < $2::date
     GROUP BY product_id`,
    [start, end],
  );
  for (const r of purch.rows) purchByProduct.set(r.product_id, Number(r.value));

  const saleByProduct = new Map<string, { revenue: number; cogs: number }>();
  const sale = await db.query<{ product_id: string; revenue: string; cogs: string }>(
    `SELECT product_id,
            COALESCE(sum(total_price_satang), 0)::text AS revenue,
            COALESCE(sum(cogs_satang), 0)::text        AS cogs
     FROM sales
     WHERE status = 'ACTIVE' AND occurred_on >= $1::date AND occurred_on < $2::date
     GROUP BY product_id`,
    [start, end],
  );
  for (const r of sale.rows) {
    saleByProduct.set(r.product_id, { revenue: Number(r.revenue), cogs: Number(r.cogs) });
  }

  const rows: MonthlyReportRow[] = [];
  const totals = { purchasesValueSatang: 0, salesRevenueSatang: 0, estimatedCogsSatang: 0 };

  for (const r of qtyRes.rows) {
    const purchasesValueSatang = purchByProduct.get(r.id) ?? 0;
    const s = saleByProduct.get(r.id) ?? { revenue: 0, cogs: 0 };
    const opening = new Decimal(r.opening);
    const purchasesQty = new Decimal(r.purchases_qty);
    const salesQty = new Decimal(r.sales_qty);
    const closing = new Decimal(r.closing);

    const hasActivity =
      !opening.isZero() ||
      !purchasesQty.isZero() ||
      !salesQty.isZero() ||
      purchasesValueSatang !== 0 ||
      s.revenue !== 0;
    if (!hasActivity) continue;

    const gp = s.revenue - s.cogs;
    rows.push({
      productId: r.id,
      sku: r.sku,
      name: r.name,
      openingQty: opening.toString(),
      purchasesQty: purchasesQty.toString(),
      purchasesValueSatang,
      salesQty: salesQty.toString(),
      salesRevenueSatang: s.revenue,
      estimatedCogsSatang: s.cogs,
      estimatedGrossProfitSatang: gp,
      grossMarginPct: marginPct(gp, s.revenue),
      closingQty: closing.toString(),
    });
    totals.purchasesValueSatang += purchasesValueSatang;
    totals.salesRevenueSatang += s.revenue;
    totals.estimatedCogsSatang += s.cogs;
  }

  const totalGp = totals.salesRevenueSatang - totals.estimatedCogsSatang;
  return {
    ym,
    rows,
    totals: {
      ...totals,
      estimatedGrossProfitSatang: totalGp,
      grossMarginPct: marginPct(totalGp, totals.salesRevenueSatang),
    },
  };
}

export interface LowStockRow {
  productId: string;
  sku: string;
  name: string;
  qtyOnHand: string;
  minStock: string;
  shortfall: string;
}

/** Products with `0 <= qtyOnHand <= minStock` (spec §21, API.md §7). */
export async function lowStockReport(db: Queryable): Promise<LowStockRow[]> {
  const { rows } = await db.query<{
    id: string;
    sku: string;
    name: string;
    qty: string;
    min_stock: string;
  }>(
    `SELECT p.id, p.sku, p.name, ss.qty_on_hand::text AS qty, p.min_stock::text AS min_stock
     FROM products p
     JOIN stock_state ss ON ss.product_id = p.id
     WHERE p.active = true AND ss.qty_on_hand >= 0 AND ss.qty_on_hand <= p.min_stock
     ORDER BY (ss.qty_on_hand - p.min_stock) ASC, p.sku ASC`,
  );
  return rows.map((r) => {
    const qty = new Decimal(r.qty);
    const min = new Decimal(r.min_stock);
    return {
      productId: r.id,
      sku: r.sku,
      name: r.name,
      qtyOnHand: qty.toString(),
      minStock: min.toString(),
      shortfall: Decimal.max(min.minus(qty), 0).toString(),
    };
  });
}

export interface OversoldRow {
  productId: string;
  sku: string;
  name: string;
  qtyOnHand: string;
  missingBalance: string;
}

/** Products with `qtyOnHand < 0` + their Missing Balance (spec §6.2, API.md §7). */
export async function oversoldReport(db: Queryable): Promise<OversoldRow[]> {
  const { rows } = await db.query<{
    id: string;
    sku: string;
    name: string;
    qty: string;
  }>(
    `SELECT p.id, p.sku, p.name, ss.qty_on_hand::text AS qty
     FROM products p
     JOIN stock_state ss ON ss.product_id = p.id
     WHERE ss.qty_on_hand < 0
     ORDER BY ss.qty_on_hand ASC, p.sku ASC`,
  );
  return rows.map((r) => {
    const qty = new Decimal(r.qty);
    return {
      productId: r.id,
      sku: r.sku,
      name: r.name,
      qtyOnHand: qty.toString(),
      missingBalance: qty.abs().toString(),
    };
  });
}
