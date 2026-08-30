import { Decimal } from './decimal.js';
import { addSatang, asSatang, multiplySatang, type Satang } from './satang.js';

export type VatRate = 0 | 7;
export const VAT_RATES: VatRate[] = [0, 7];

export interface InvoiceLineMoney {
  netSatang: Satang;   // ex-VAT: roundHalfUp(quantity × unitPriceSatang)
  vatSatang: Satang;   // roundHalfUp(net × rate / 100)
  totalSatang: Satang; // net + vat
}

/** Per-line money, server-side, round-half-up throughout (spec §9.1). */
export function computeLine(
  unitPriceSatang: Satang,
  quantity: Decimal.Value,
  vatRate: VatRate,
): InvoiceLineMoney {
  const net = multiplySatang(unitPriceSatang, quantity);
  const vat = asSatang(
    new Decimal(net).times(vatRate).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
  );
  return { netSatang: net, vatSatang: vat, totalSatang: addSatang(net, vat) };
}

export interface InvoiceTotals {
  subtotalSatang: Satang;
  vatSatang: Satang;
  totalSatang: Satang;
}

export function sumInvoice(lines: InvoiceLineMoney[]): InvoiceTotals {
  const subtotal = addSatang(...lines.map((l) => l.netSatang), asSatang(0));
  const vat = addSatang(...lines.map((l) => l.vatSatang), asSatang(0));
  return { subtotalSatang: subtotal, vatSatang: vat, totalSatang: addSatang(subtotal, vat) };
}
