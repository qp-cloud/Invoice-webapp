import { AppError, type ListProductsQuery } from '@inventory/shared';
import * as XLSX from 'xlsx';
import type { Database } from '../db/client.js';
import { getLedger } from './ledger.js';
import { listProducts } from './products.js';
import { lowStockReport, monthlyReport, oversoldReport } from './reports.js';
import { getCurrentFiscalYear } from './settings.js';

export const EXPORT_KINDS = [
  'current-stock',
  'ledger',
  'purchases',
  'sales',
  'monthly-report',
  'low-stock',
  'oversold',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

function toBuffer(rows: Record<string, unknown>[], sheetName: string): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const thb = (satang: number): number => Math.round(satang) / 100;

export async function buildExport(
  db: Database,
  kind: ExportKind,
  params: { productId?: string; ym?: string },
): Promise<{ buffer: Buffer; filename: string }> {
  switch (kind) {
    case 'current-stock': {
      const cfy = await getCurrentFiscalYear(db);
      const query: ListProductsQuery = { page: 1, pageSize: 100_000, sort: 'sku', dir: 'asc' };
      const page = await listProducts(db, query, cfy);
      const rows = page.rows.map((p) => ({
        sku: p.sku,
        name: p.name,
        unit: p.unitCode,
        stock_68: p.fyView?.stock68 ?? '0',
        purchases_cfy: p.fyView?.purchasesCfy ?? '0',
        sales_cfy: p.fyView?.salesCfy ?? '0',
        qty_on_hand: p.stock.qtyOnHand,
        variance: p.fyView?.variance ?? '0',
        min_stock: p.minStock,
        status: p.stock.status,
        avg_cost_thb: thb(p.stock.avgCostSatang),
      }));
      return { buffer: toBuffer(rows, 'current-stock'), filename: 'current-stock.xlsx' };
    }
    case 'ledger': {
      if (!params.productId) {
        throw new AppError('VALIDATION_FAILED', { userMessage: 'ต้องระบุ productId' });
      }
      const led = await getLedger(db, params.productId, { page: 1, pageSize: 100_000 });
      const rows = led.rows.map((r) => ({
        date: r.occurredOn,
        type: r.type,
        quantity: r.quantity,
        running_balance: r.runningBalance,
        unit_cost_thb: r.unitCostSatang == null ? '' : thb(r.unitCostSatang),
        status: r.status,
        void_reason: r.voidReason ?? '',
      }));
      return { buffer: toBuffer(rows, 'ledger'), filename: `ledger-${params.productId}.xlsx` };
    }
    case 'purchases':
    case 'sales': {
      const table = kind;
      const res = await db.query<Record<string, unknown>>(
        `SELECT p.sku, d.occurred_on AS date, d.quantity,
                ${kind === 'purchases' ? 'd.unit_cost_satang, d.total_cost_satang' : 'd.unit_price_satang, d.total_price_satang, d.cogs_satang'},
                d.status
         FROM ${table} d JOIN products p ON p.id = d.product_id
         ORDER BY d.occurred_on, p.sku`,
      );
      const rows = res.rows.map((r) => {
        const out: Record<string, unknown> = { sku: r.sku, date: r.date, quantity: r.quantity, status: r.status };
        for (const [k, v] of Object.entries(r)) {
          if (k.endsWith('_satang')) out[k.replace('_satang', '_thb')] = thb(Number(v));
        }
        return out;
      });
      return { buffer: toBuffer(rows, kind), filename: `${kind}.xlsx` };
    }
    case 'monthly-report': {
      if (!params.ym) throw new AppError('VALIDATION_FAILED', { userMessage: 'ต้องระบุ ym' });
      const rep = await monthlyReport(db, params.ym);
      const rows = rep.rows.map((r) => ({
        sku: r.sku,
        name: r.name,
        opening: r.openingQty,
        purchases_qty: r.purchasesQty,
        purchases_value_thb: thb(r.purchasesValueSatang),
        sales_qty: r.salesQty,
        sales_revenue_thb: thb(r.salesRevenueSatang),
        cogs_thb: thb(r.estimatedCogsSatang),
        gross_profit_thb: thb(r.estimatedGrossProfitSatang),
        margin_pct: r.grossMarginPct ?? '',
        closing: r.closingQty,
      }));
      return { buffer: toBuffer(rows, `monthly-${params.ym}`), filename: `monthly-report-${params.ym}.xlsx` };
    }
    case 'low-stock': {
      const rep = await lowStockReport(db);
      const rows = rep.map((r) => ({
        sku: r.sku, name: r.name, qty_on_hand: r.qtyOnHand, min_stock: r.minStock, shortfall: r.shortfall,
      }));
      return { buffer: toBuffer(rows, 'low-stock'), filename: 'low-stock.xlsx' };
    }
    case 'oversold': {
      const rep = await oversoldReport(db);
      const rows = rep.map((r) => ({
        sku: r.sku, name: r.name, qty_on_hand: r.qtyOnHand, missing_balance: r.missingBalance,
      }));
      return { buffer: toBuffer(rows, 'oversold'), filename: 'oversold.xlsx' };
    }
    default:
      throw new AppError('VALIDATION_FAILED', { userMessage: 'ประเภทการส่งออกไม่ถูกต้อง' });
  }
}
