import { describe, expect, it } from 'vitest';
import { cleanSku } from '../sku.js';
import { SanitizationError } from '../errors.js';

describe('cleanSku', () => {
  it.each([
    [' sku-001 ', 'SKU-001'],
    ['sku 001', 'SKU 001'],
    ['sku\t\t001', 'SKU 001'],
    ['SkU-abc-123', 'SKU-ABC-123'],
    [123, '123'],
  ])('%j -> %j', (input, expected) => {
    expect(cleanSku(input)).toBe(expected);
  });

  it.each(['', '   ', '\t', null, undefined, {}, []])('rejects %j', (bad) => {
    try {
      cleanSku(bad);
      throw new Error('should have thrown');
    } catch (err) {
      expect(SanitizationError.is(err)).toBe(true);
      expect((err as SanitizationError).code).toBe('SKU_REQUIRED');
    }
  });
});
