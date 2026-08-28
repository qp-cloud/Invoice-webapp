import { describe, expect, it } from 'vitest';
import {
  currentStock,
  currentStock6869,
  movementVariance,
} from '../stockFormula.js';
import { signFor, signedQuantity } from '../movementTypes.js';
import { isOversold, missingBalance, stockStatus } from '../status.js';

describe('movement types', () => {
  it('sign per type', () => {
    expect(signFor('PURCHASE')).toBe(1);
    expect(signFor('CUSTOMER_RETURN')).toBe(1);
    expect(signFor('SALE')).toBe(-1);
    expect(signFor('DAMAGE')).toBe(-1);
    expect(signFor('ADJUSTMENT')).toBe(0);
  });
  it('signedQuantity', () => {
    expect(signedQuantity('PURCHASE', '500').toString()).toBe('500');
    expect(signedQuantity('SALE', '120').toString()).toBe('-120');
    expect(signedQuantity('ADJUSTMENT', '-10').toString()).toBe('-10');
    expect(signedQuantity('ADJUSTMENT', '7').toString()).toBe('7');
  });
});

describe('stock formulas', () => {
  it('currentStock sums ACTIVE movements, excludes VOIDED (spec §11 example)', () => {
    const ledger = [
      { quantity: '1000', status: 'ACTIVE' as const }, // OPENING
      { quantity: '500', status: 'ACTIVE' as const }, // PURCHASE
      { quantity: '-120', status: 'ACTIVE' as const }, // SALE
      { quantity: '-10', status: 'ACTIVE' as const }, // DAMAGE
      { quantity: '20', status: 'ACTIVE' as const }, // CUSTOMER_RETURN
    ];
    expect(currentStock(ledger).toString()).toBe('1390');

    const withVoid = [...ledger, { quantity: '-999', status: 'VOIDED' as const }];
    expect(currentStock(withVoid).toString()).toBe('1390');
  });

  it('68/69 worked example (spec §5.5)', () => {
    expect(
      currentStock6869({ openingQty: '1000', purchasesCfyQty: '8000', salesCfyQty: '7700' }).toString(),
    ).toBe('1300');
    expect(movementVariance('8000', '7700').toString()).toBe('300');
  });

  it('mock dataset expected stock + variance (spec §23)', () => {
    const cases = [
      { o: '1000', p: '8000', s: '7700', stock: '1300', variance: '300' },
      { o: '500', p: '5000', s: '5350', stock: '150', variance: '-350' },
      { o: '200', p: '300', s: '500', stock: '0', variance: '-200' },
      { o: '50', p: '0', s: '70', stock: '-20', variance: '-70' },
    ];
    for (const c of cases) {
      expect(
        currentStock6869({ openingQty: c.o, purchasesCfyQty: c.p, salesCfyQty: c.s }).toString(),
      ).toBe(c.stock);
      expect(movementVariance(c.p, c.s).toString()).toBe(c.variance);
    }
  });
});

describe('stock status (spec §6.2)', () => {
  it.each([
    ['1000', '500', 'normal'],
    ['500', '500', 'low'], // min itself is amber
    ['1', '500', 'low'],
    ['0', '50', 'out'],
    ['-20', '20', 'out'],
  ])('qty %s / min %s -> %s', (qty, min, expected) => {
    expect(stockStatus(qty, min)).toBe(expected);
  });

  it('oversold + missing balance', () => {
    expect(isOversold('-20')).toBe(true);
    expect(isOversold('0')).toBe(false);
    expect(missingBalance('-20').toString()).toBe('20');
    expect(missingBalance('5').toString()).toBe('0');
  });
});
