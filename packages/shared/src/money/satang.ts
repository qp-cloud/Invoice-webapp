import { Decimal } from 'decimal.js';
import { toDecimal } from './decimal.js';

/**
 * Money is an integer number of **satang** (1 THB = 100 satang), never a float,
 * never a fractional value (spec §9.1, §19). The brand keeps satang from being
 * mixed with plain numbers or with quantities.
 */
export type Satang = number & { readonly __brand: 'Satang' };

/** Assert an integer and brand it. */
export function asSatang(n: number): Satang {
  if (!Number.isInteger(n)) {
    throw new RangeError(`satang must be an integer, got ${n}`);
  }
  return n as Satang;
}

/** THB amount (Decimal/string/number) → integer satang, round-half-up (spec §26.1 #5). */
export function toSatang(thb: Decimal.Value): Satang {
  const satang = toDecimal(thb).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return asSatang(satang.toNumber());
}

/** Integer satang → Decimal THB (for display / further math). */
export function fromSatang(s: Satang): Decimal {
  return new Decimal(s).div(100);
}

/** unitCost (satang) × quantity (Decimal) → integer satang total, round-half-up. */
export function multiplySatang(unit: Satang, quantity: Decimal.Value): Satang {
  const total = new Decimal(unit)
    .times(toDecimal(quantity))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return asSatang(total.toNumber());
}

export function addSatang(...values: Satang[]): Satang {
  return asSatang(values.reduce((sum, v) => sum + v, 0));
}

export function subtractSatang(a: Satang, b: Satang): Satang {
  return asSatang(a - b);
}

// --- micro-THB: average unit cost is carried at 1e-6 THB precision to limit drift
//     over many movements (spec §9.2). 1 THB = 1_000_000 micro = 100 satang.

export type Micro = number & { readonly __brand: 'Micro' };

export function asMicro(n: number): Micro {
  if (!Number.isInteger(n)) throw new RangeError(`micro must be an integer, got ${n}`);
  return n as Micro;
}

/** satang → micro-THB (exact: ×10_000). */
export function satangToMicro(s: Satang): Micro {
  return asMicro(s * 10_000);
}

/** micro-THB unit cost × quantity → integer satang, round-half-up. Used for COGS. */
export function microTimesQtyToSatang(micro: Micro, quantity: Decimal.Value): Satang {
  const satang = new Decimal(micro)
    .div(10_000)
    .times(toDecimal(quantity))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return asSatang(satang.toNumber());
}

/** Weighted average: totalCost (satang) / qtyOnHand (Decimal) → micro-THB unit cost. */
export function averageMicro(totalCostSatang: Satang, qtyOnHand: Decimal.Value): Micro {
  const qty = toDecimal(qtyOnHand);
  if (qty.isZero()) return asMicro(0);
  const micro = new Decimal(totalCostSatang)
    .times(10_000)
    .div(qty)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return asMicro(micro.toNumber());
}
