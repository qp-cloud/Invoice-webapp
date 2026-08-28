import { describe, expect, it } from 'vitest';
import { Decimal } from '../decimal.js';
import {
  addSatang,
  asSatang,
  averageMicro,
  fromSatang,
  microTimesQtyToSatang,
  multiplySatang,
  satangToMicro,
  toSatang,
} from '../satang.js';

describe('satang', () => {
  it('converts THB to integer satang, round-half-up', () => {
    expect(toSatang('1250.00')).toBe(125000);
    expect(toSatang('120')).toBe(12000);
    expect(toSatang('0.005')).toBe(1); // 0.5 satang -> up
    expect(toSatang('0.004')).toBe(0);
    expect(toSatang(new Decimal('106.666667'))).toBe(10667);
  });

  it('round-trips', () => {
    for (const thb of ['0', '1', '19.99', '1250.00', '999999.99']) {
      const s = toSatang(thb);
      expect(fromSatang(s).toFixed(2)).toBe(new Decimal(thb).toFixed(2));
    }
  });

  it('is immune to binary float error (0.1 + 0.2)', () => {
    const sum = addSatang(toSatang('0.1'), toSatang('0.2'));
    expect(sum).toBe(30);
    expect(fromSatang(sum).toString()).toBe('0.3');
  });

  it('rejects non-integer satang', () => {
    expect(() => asSatang(1.5)).toThrow();
  });

  it('multiplySatang: unit cost x quantity, round-half-up', () => {
    expect(multiplySatang(asSatang(12000), '500')).toBe(6_000_000); // 500 x ฿120
    expect(multiplySatang(asSatang(15000), '120')).toBe(1_800_000);
    expect(multiplySatang(asSatang(3333), '3')).toBe(9999);
  });

  it('weighted-average micro cost and COGS (spec §9.3 example)', () => {
    // opening 1000 x ฿100  +  purchase 500 x ฿120  => 160,000.00 over 1,500
    const totalCost = addSatang(
      multiplySatang(asSatang(toSatang('100')), '1000'),
      multiplySatang(asSatang(toSatang('120')), '500'),
    );
    expect(totalCost).toBe(16_000_000);
    const avg = averageMicro(totalCost, '1500');
    expect(avg).toBe(106_666_667); // 106.666667 THB in micro
    // sale of 200 units
    const cogs = microTimesQtyToSatang(avg, '200');
    expect(cogs).toBe(2_133_333); // ฿21,333.33 (round-half-up), not ฿21,334
  });

  it('satangToMicro is exact', () => {
    expect(satangToMicro(asSatang(10667))).toBe(106_670_000);
  });
});
