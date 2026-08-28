import { Decimal } from 'decimal.js';
import {
  asMicro,
  asSatang,
  averageMicro,
  type Micro,
  microTimesQtyToSatang,
  multiplySatang,
  type Satang,
  satangToMicro,
} from '../money/satang.js';
import { COSTED_INFLOW_TYPES, type MovementType } from './movementTypes.js';

export interface LedgerMovement {
  type: MovementType;
  /** Signed quantity as stored in movements.quantity (string is fine). */
  quantity: Decimal.Value;
  unitCostSatang?: number | null;
  status?: 'ACTIVE' | 'VOIDED';
}

export interface CostState {
  qtyOnHand: Decimal;
  totalCostSatang: Satang;
  avgCostMicro: Micro;
  lastNonzeroAvgMicro: Micro;
}

export interface CostStep {
  state: CostState;
  /** COGS booked by this movement (costed outflows only; 0 otherwise / VOIDED). */
  cogsSatang: Satang;
  /** true when the weighted-average basis was reset (spec §9.2 edge, open Q #4). */
  reset: boolean;
}

export const ZERO_COST_STATE: CostState = {
  qtyOnHand: new Decimal(0),
  totalCostSatang: asSatang(0),
  avgCostMicro: asMicro(0),
  lastNonzeroAvgMicro: asMicro(0),
};

const isInflow = (t: MovementType): boolean =>
  ['OPENING', 'PURCHASE', 'CUSTOMER_RETURN', 'TRANSFER_IN'].includes(t);

/**
 * Apply one movement to the running quantity + weighted-average cost (spec §9.2).
 * Pure. `replayLedger` folds this; the live post path calls it once.
 *
 *  - OPENING / PURCHASE                : add at their own unit cost.
 *  - CUSTOMER_RETURN / positive ADJUST : add at the movement's (owner-entered) unit cost;
 *                                        if absent, at the last known average.
 *  - SALE / SUPPLIER_RETURN / DAMAGE / negative ADJUST : remove at current avg; book COGS.
 *  - Costed inflow while qtyOnHand < 0 : reset the basis to the incoming unit cost.
 */
export function costStep(prev: CostState, m: LedgerMovement): CostStep {
  if (m.status === 'VOIDED') {
    return { state: prev, cogsSatang: asSatang(0), reset: false };
  }

  const signedQty = new Decimal(m.quantity);
  const magnitude = signedQty.abs();
  const inflow = isInflow(m.type) || (m.type === 'ADJUSTMENT' && signedQty.gt(0));

  let qty = prev.qtyOnHand;
  let totalCost: number = prev.totalCostSatang;
  let avgMicro: number = prev.avgCostMicro;
  let lastNonzeroAvg: number = prev.lastNonzeroAvgMicro;
  let cogs = 0;
  let reset = false;

  if (inflow) {
    const costed = COSTED_INFLOW_TYPES.includes(m.type) || m.type === 'ADJUSTMENT';
    if (costed) {
      const perUnit =
        m.unitCostSatang != null
          ? asSatang(m.unitCostSatang)
          : asSatang(Math.round(lastNonzeroAvg / 10_000));
      if (qty.lt(0)) {
        qty = qty.plus(magnitude);
        avgMicro = satangToMicro(perUnit);
        totalCost = qty.gt(0) ? multiplySatang(perUnit, qty) : 0;
        reset = true;
      } else {
        totalCost = asSatang(totalCost + multiplySatang(perUnit, magnitude));
        qty = qty.plus(magnitude);
        avgMicro = averageMicro(asSatang(totalCost), qty);
      }
    } else {
      qty = qty.plus(magnitude); // uncosted inflow (TRANSFER_IN)
    }
  } else {
    cogs = microTimesQtyToSatang(asMicro(avgMicro), magnitude);
    qty = qty.minus(magnitude);
    totalCost = asSatang(Math.max(0, totalCost - cogs));
    if (qty.lte(0)) totalCost = 0;
  }

  if (avgMicro > 0) lastNonzeroAvg = avgMicro;

  return {
    state: {
      qtyOnHand: qty,
      totalCostSatang: asSatang(totalCost),
      avgCostMicro: asMicro(avgMicro),
      lastNonzeroAvgMicro: asMicro(lastNonzeroAvg),
    },
    cogsSatang: asSatang(cogs),
    reset,
  };
}

export interface ReplayResult extends CostState {
  cogsByIndex: number[];
  costBasisResets: number[];
}

/** Fold `costStep` over an ordered movement list (spec §9.4). */
export function replayLedger(movements: readonly LedgerMovement[]): ReplayResult {
  let state = ZERO_COST_STATE;
  const cogsByIndex: number[] = [];
  const costBasisResets: number[] = [];
  movements.forEach((m, i) => {
    const step = costStep(state, m);
    state = step.state;
    cogsByIndex[i] = step.cogsSatang;
    if (step.reset) costBasisResets.push(i);
  });
  return { ...state, cogsByIndex, costBasisResets };
}

/** micro-THB -> Decimal THB. */
export function microToThb(micro: number): Decimal {
  return new Decimal(micro).div(1_000_000);
}
