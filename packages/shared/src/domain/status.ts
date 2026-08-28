import { Decimal } from 'decimal.js';

/** spec §6.2 — 🟢 normal / 🟡 low / 🔴 out. */
export type StockStatus = 'normal' | 'low' | 'out';

/**
 *   stock <= 0            -> out   (red; also oversold when < 0)
 *   0 < stock <= minStock -> low   (amber; minStock itself is amber)
 *   stock > minStock      -> normal
 */
export function stockStatus(qtyOnHand: Decimal.Value, minStock: Decimal.Value): StockStatus {
  const qty = new Decimal(qtyOnHand);
  if (qty.lte(0)) return 'out';
  if (qty.lte(new Decimal(minStock))) return 'low';
  return 'normal';
}

export function isOversold(qtyOnHand: Decimal.Value): boolean {
  return new Decimal(qtyOnHand).lt(0);
}

/** Absolute shortfall when oversold, else 0 (spec §4, §6.1). */
export function missingBalance(qtyOnHand: Decimal.Value): Decimal {
  const qty = new Decimal(qtyOnHand);
  return qty.lt(0) ? qty.abs() : new Decimal(0);
}
