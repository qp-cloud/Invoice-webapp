import { Decimal } from 'decimal.js';
import { fromSatang, type Satang } from '../money/satang.js';

const grouper = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Money display: `1,234.00` (spec §19.4, §36). Optionally prefixed with ฿. */
export function formatThb(satang: Satang, opts: { withSymbol?: boolean } = {}): string {
  const thb = fromSatang(satang);
  const text = grouper.format(thb.toNumber());
  return opts.withSymbol ? `฿${text}` : text;
}

/**
 * Quantity display: thousands-grouped, up to 3 dp, no padding of insignificant zeros
 * beyond what the value needs (spec §19.4). `1250` -> "1,250", `10.5` -> "10.5".
 */
export function formatQuantity(value: Decimal.Value): string {
  const d = new Decimal(value);
  const dp = Math.min(d.decimalPlaces(), 3);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: dp,
  }).format(d.toNumber());
}
