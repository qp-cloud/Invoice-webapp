import { describe, expect, it } from 'vitest';
import { SanitizationError } from '../errors.js';
import { cleanMoneySatang, cleanQuantity, normalizeNumberString } from '../number.js';

describe('normalizeNumberString', () => {
  it.each([
    ['1,250.00', '1250.00'],
    ['฿1,250.00', '1250.00'],
    [' 1,250.00 ฿', '1250.00'],
    ['1 250.00', '1250.00'],
    ['1250', '1250'],
    ['THB 1,250', '1250'],
    ['1,250.00 บาท', '1250.00'],
    ['(1,250.00)', '-1250.00'],
    ['-1250', '-1250'],
    ['+1250', '1250'],
    ['0.125', '0.125'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeNumberString(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', 'NaN', 'Infinity', '1.2.3', '--1', '1,2,3.', Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %j as NOT_A_NUMBER',
    (bad) => {
      try {
        normalizeNumberString(bad as unknown);
        throw new Error('should have thrown');
      } catch (err) {
        expect(SanitizationError.is(err)).toBe(true);
        expect((err as SanitizationError).code).toBe('NOT_A_NUMBER');
      }
    },
  );
});

describe('cleanMoneySatang', () => {
  it.each([
    ['1,250.00', 125000],
    ['฿1,250.00', 125000],
    [' 1,250.00 ฿', 125000],
    ['1 250.00', 125000],
    ['1250', 125000],
    ['19.99', 1999],
    ['0.005', 1], // round-half-up
  ])('%j -> %d satang', (input, expected) => {
    expect(cleanMoneySatang(input)).toBe(expected);
  });

  it('rejects a negative amount unless allowNegative', () => {
    expect(() => cleanMoneySatang('(1,250.00)')).toThrow(SanitizationError);
    try {
      cleanMoneySatang('-5');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as SanitizationError).code).toBe('NEGATIVE_NOT_ALLOWED');
    }
    expect(cleanMoneySatang('-5', { allowNegative: true })).toBe(-500);
  });

  it.each(['', 'abc', 'NaN'])('rejects %j', (bad) => {
    expect(() => cleanMoneySatang(bad)).toThrow(SanitizationError);
  });
});

describe('cleanQuantity', () => {
  it.each([
    ['0.125', '0.125'],
    ['1.5', '1.5'],
    ['10.75', '10.75'],
    ['1,250', '1250'],
    ['1 250.5', '1250.5'],
    ['1250', '1250'],
  ])('%j -> %s', (input, expected) => {
    expect(cleanQuantity(input).toString()).toBe(expected);
  });

  it('rejects more than 3 decimal places', () => {
    try {
      cleanQuantity('10.1234');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as SanitizationError).code).toBe('QUANTITY_PRECISION');
    }
  });

  it.each(['', 'abc', 'NaN', 'Infinity'])('rejects %j', (bad) => {
    try {
      cleanQuantity(bad);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as SanitizationError).code).toBe('NOT_A_NUMBER');
    }
  });

  it('allows a signed quantity (adjustment delta)', () => {
    expect(cleanQuantity('-10').toString()).toBe('-10');
  });
});
