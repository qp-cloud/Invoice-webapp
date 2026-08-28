import { describe, expect, it } from 'vitest';
import { asSatang } from '../../money/satang.js';
import { formatQuantity, formatThb } from '../number.js';
import { buddhistYear, monthLabelTh, toBuddhistDisplay } from '../date.js';

describe('format/number', () => {
  it('money as 1,234.00', () => {
    expect(formatThb(asSatang(123400))).toBe('1,234.00');
    expect(formatThb(asSatang(0))).toBe('0.00');
    expect(formatThb(asSatang(100000000))).toBe('1,000,000.00');
    expect(formatThb(asSatang(123400), { withSymbol: true })).toBe('฿1,234.00');
  });

  it('quantity grouped, up to 3 dp, no needless padding', () => {
    expect(formatQuantity('1250')).toBe('1,250');
    expect(formatQuantity('1250.5')).toBe('1,250.5');
    expect(formatQuantity('0.125')).toBe('0.125');
    expect(formatQuantity('-20')).toBe('-20');
  });
});

describe('format/date', () => {
  it('Buddhist year + display', () => {
    expect(buddhistYear(2026)).toBe(2569);
    expect(toBuddhistDisplay('2026-08-29')).toBe('29/08/2569');
  });
  it('Thai month label', () => {
    expect(monthLabelTh('2026-01')).toBe('มกราคม 2569');
    expect(monthLabelTh('2026-08')).toBe('สิงหาคม 2569');
    expect(monthLabelTh('2026-12')).toBe('ธันวาคม 2569');
  });
});
