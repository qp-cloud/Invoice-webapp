import { Decimal } from 'decimal.js';

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE',
  'SALE',
  'CUSTOMER_RETURN',
  'SUPPLIER_RETURN',
  'DAMAGE',
  'ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const INFLOW_TYPES: readonly MovementType[] = [
  'OPENING',
  'PURCHASE',
  'CUSTOMER_RETURN',
  'TRANSFER_IN',
];
export const OUTFLOW_TYPES: readonly MovementType[] = [
  'SALE',
  'SUPPLIER_RETURN',
  'DAMAGE',
  'TRANSFER_OUT',
];

/** Types that carry a unit cost into the weighted-average (spec §9.2). */
export const COSTED_INFLOW_TYPES: readonly MovementType[] = [
  'OPENING',
  'PURCHASE',
  'CUSTOMER_RETURN',
];

/**
 * The sign the domain layer applies to a movement's magnitude.
 *  +1 inflow, -1 outflow, 0 = caller supplies a signed delta (ADJUSTMENT only).
 */
export function signFor(type: MovementType): 1 | -1 | 0 {
  if (type === 'ADJUSTMENT') return 0;
  return INFLOW_TYPES.includes(type) ? 1 : -1;
}

/**
 * Turn a positive magnitude + type into the signed `movements.quantity` value.
 * For ADJUSTMENT the caller passes an already-signed delta as `magnitude`.
 */
export function signedQuantity(type: MovementType, magnitude: Decimal.Value): Decimal {
  const value = new Decimal(magnitude);
  const sign = signFor(type);
  if (sign === 0) return value; // ADJUSTMENT: value is already signed
  return value.abs().times(sign);
}
