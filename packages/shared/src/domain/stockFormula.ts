import { Decimal } from 'decimal.js';

export interface QuantityCarrier {
  quantity: Decimal.Value;
  status?: 'ACTIVE' | 'VOIDED';
}

/**
 * Current stock = Σ quantity of ACTIVE movements (spec §5.2).
 * VOIDED movements are excluded (spec §5.6).
 */
export function currentStock(movements: readonly QuantityCarrier[]): Decimal {
  return movements.reduce(
    (sum, m) => (m.status === 'VOIDED' ? sum : sum.plus(new Decimal(m.quantity))),
    new Decimal(0),
  );
}

/** 68/69 view (spec §5.3): opening + current-FY purchases − current-FY sales. */
export function currentStock6869(input: {
  openingQty: Decimal.Value;
  purchasesCfyQty: Decimal.Value;
  salesCfyQty: Decimal.Value;
}): Decimal {
  return new Decimal(input.openingQty)
    .plus(new Decimal(input.purchasesCfyQty))
    .minus(new Decimal(input.salesCfyQty));
}

/** Movement variance = current-FY purchases − current-FY sales (spec §5.4). */
export function movementVariance(
  purchasesCfyQty: Decimal.Value,
  salesCfyQty: Decimal.Value,
): Decimal {
  return new Decimal(purchasesCfyQty).minus(new Decimal(salesCfyQty));
}
