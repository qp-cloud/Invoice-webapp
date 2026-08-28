import { describe, expect, it } from 'vitest';
import { replayLedger, type LedgerMovement } from '../replayLedger.js';
import { movementVariance } from '../stockFormula.js';
import { stockStatus } from '../status.js';

const S = (thb: number): number => Math.round(thb * 100); // THB -> satang

describe('replayLedger', () => {
  it('spec §11 ledger example -> 1390', () => {
    const ml: LedgerMovement[] = [
      { type: 'OPENING', quantity: '1000', unitCostSatang: S(100) },
      { type: 'PURCHASE', quantity: '500', unitCostSatang: S(100) },
      { type: 'SALE', quantity: '-120' },
      { type: 'DAMAGE', quantity: '-10' },
      { type: 'CUSTOMER_RETURN', quantity: '20', unitCostSatang: S(100) },
    ];
    expect(replayLedger(ml).qtyOnHand.toString()).toBe('1390');
  });

  it('spec §9.3 weighted-average + COGS', () => {
    const ml: LedgerMovement[] = [
      { type: 'OPENING', quantity: '1000', unitCostSatang: S(100) },
      { type: 'PURCHASE', quantity: '500', unitCostSatang: S(120) },
      { type: 'SALE', quantity: '-200' },
    ];
    const r = replayLedger(ml);
    expect(r.qtyOnHand.toString()).toBe('1300');
    expect(r.avgCostMicro).toBe(106_666_667);
    expect(r.cogsByIndex[2]).toBe(2_133_333); // ฿21,333.33 round-half-up
    expect(r.totalCostSatang).toBe(16_000_000 - 2_133_333);
  });

  it('excludes VOIDED movements (spec §5.6)', () => {
    const ml: LedgerMovement[] = [
      { type: 'OPENING', quantity: '100', unitCostSatang: S(10) },
      { type: 'SALE', quantity: '-40', status: 'VOIDED' },
      { type: 'SALE', quantity: '-10' },
    ];
    expect(replayLedger(ml).qtyOnHand.toString()).toBe('90');
  });

  it('resets cost basis on a costed inflow while qtyOnHand <= 0 (spec §9.2, open Q #4)', () => {
    const ml: LedgerMovement[] = [
      { type: 'OPENING', quantity: '10', unitCostSatang: S(100) },
      { type: 'SALE', quantity: '-30' }, // qty now -20, oversold (ALLOW mode)
      { type: 'PURCHASE', quantity: '50', unitCostSatang: S(200) },
    ];
    const r = replayLedger(ml);
    expect(r.qtyOnHand.toString()).toBe('30');
    expect(r.costBasisResets).toEqual([2]);
    expect(r.avgCostMicro).toBe(200_000_000); // = incoming ฿200, not a blended figure
    expect(r.totalCostSatang).toBe(S(200) * 30);
  });

  it('mock dataset golden master (spec §23)', () => {
    const cases = [
      { o: '1000', p: '8000', s: '7700', qty: '1300', variance: '300', status: 'normal', min: '500' },
      { o: '500', p: '5000', s: '5350', qty: '150', variance: '-350', status: 'low', min: '300' },
      { o: '200', p: '300', s: '500', qty: '0', variance: '-200', status: 'out', min: '50' },
      { o: '50', p: '0', s: '70', qty: '-20', variance: '-70', status: 'out', min: '20' },
    ];
    for (const c of cases) {
      const ml: LedgerMovement[] = [
        { type: 'OPENING', quantity: c.o, unitCostSatang: S(100) },
        ...(c.p !== '0' ? [{ type: 'PURCHASE' as const, quantity: c.p, unitCostSatang: S(100) }] : []),
        ...(c.s !== '0' ? [{ type: 'SALE' as const, quantity: `-${c.s}` }] : []),
      ];
      const r = replayLedger(ml);
      expect(r.qtyOnHand.toString()).toBe(c.qty);
      expect(movementVariance(c.p, c.s).toString()).toBe(c.variance);
      expect(stockStatus(r.qtyOnHand.toString(), c.min)).toBe(c.status);
    }
  });

  it('customer return / positive adjustment enter at their own (owner) unit cost', () => {
    const ml: LedgerMovement[] = [
      { type: 'OPENING', quantity: '100', unitCostSatang: S(100) }, // total 10,000
      { type: 'CUSTOMER_RETURN', quantity: '10', unitCostSatang: S(130) }, // +1,300 -> 11,300 / 110
      { type: 'ADJUSTMENT', quantity: '10', unitCostSatang: S(120) }, // +1,200 -> 12,500 / 120
    ];
    const r = replayLedger(ml);
    expect(r.qtyOnHand.toString()).toBe('120');
    expect(r.totalCostSatang).toBe(S(12_500)); // ฿12,500 on hand
    expect(r.avgCostMicro).toBe(Math.round((S(12_500) * 10_000) / 120));
  });
});
