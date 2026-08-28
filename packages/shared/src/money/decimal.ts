import { Decimal } from 'decimal.js';

// One shared Decimal configuration for the whole app. High precision so intermediate
// weighted-average math does not lose digits; rounding is always explicit at the point
// a value is persisted (spec §9.1, §19).
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal } from 'decimal.js';
export type DecimalInput = Decimal.Value;

/** Parse anything numeric-ish into a Decimal, or throw. No float coercion. */
export function toDecimal(value: Decimal.Value): Decimal {
  const d = new Decimal(value);
  if (!d.isFinite()) throw new RangeError(`not a finite number: ${String(value)}`);
  return d;
}
