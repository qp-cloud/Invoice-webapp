import { describe, expect, it } from 'vitest';
import { cleanDate, parseDate } from '../date.js';
import { SanitizationError } from '../errors.js';

describe('cleanDate', () => {
  it.each([
    ['15/03/2026', '2026-03-15'],
    ['2026-03-15', '2026-03-15'],
    ['15-03-2026', '2026-03-15'],
    ['2026/03/15', '2026-03-15'],
    ['15/03/2569', '2026-03-15'], // Buddhist year
    ['2569-03-15', '2026-03-15'],
    ['01/01/2569', '2026-01-01'],
    ['31/12/2569', '2026-12-31'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanDate(input)).toBe(expected);
  });

  it('parses Excel serial dates (1899-12-30 epoch)', () => {
    // 2026-03-15 is serial 46096 in Excel's 1900 system
    expect(cleanDate(46096)).toBe('2026-03-15');
    expect(cleanDate('46096')).toBe('2026-03-15');
    // known anchor: 2020-01-01 = serial 43831
    expect(cleanDate(43831)).toBe('2020-01-01');
  });

  it('2-digit year: Gregorian 20xx with a warning by default', () => {
    const r = parseDate('15/03/69');
    expect(r.iso).toBe('2069-03-15');
    expect(r.warnings).toContain('DATE_ASSUMED_GREGORIAN');
  });

  it('2-digit year: Buddhist when assumeThaiYear', () => {
    const r = parseDate('15/03/69', { assumeThaiYear: true });
    expect(r.iso).toBe('2026-03-15');
    expect(r.warnings).not.toContain('DATE_ASSUMED_GREGORIAN');
  });

  it.each(['32/01/2026', '2026-13-01', 'foo', '', '2026-02-30', '1/2', '2026//03'])(
    'rejects %j as BAD_DATE',
    (bad) => {
      try {
        cleanDate(bad);
        throw new Error('should have thrown');
      } catch (err) {
        expect(SanitizationError.is(err)).toBe(true);
        expect((err as SanitizationError).code).toBe('BAD_DATE');
      }
    },
  );
});
