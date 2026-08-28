import { SanitizationError, type SanitizationWarningCode } from './errors.js';

/**
 * Excel's 1900 date system: serial 1 = 1900-01-01, but Excel wrongly treats 1900 as a
 * leap year, so day 60 (1900-02-29) does not exist. Using an epoch of 1899-12-30 makes
 * every serial >= 61 land on the correct Gregorian date, which covers all realistic
 * business dates. (spec §7.3)
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** Years at or above this are read as Buddhist Era and converted (− 543). */
const BUDDHIST_THRESHOLD = 2400;
const BUDDHIST_OFFSET = 543;

export interface DateParseResult {
  /** Gregorian ISO date, `YYYY-MM-DD`. */
  iso: string;
  warnings: SanitizationWarningCode[];
}

export interface CleanDateOptions {
  field?: string;
  /** For a 2-digit year, treat it as Buddhist (20xx BE) instead of Gregorian 20xx. */
  assumeThaiYear?: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalizeYear(
  rawYear: number,
  opts: CleanDateOptions,
  warnings: SanitizationWarningCode[],
): number {
  if (rawYear >= BUDDHIST_THRESHOLD) return rawYear - BUDDHIST_OFFSET;
  if (rawYear < 100) {
    // 2-digit year: BE 25xx → Gregorian, or Gregorian 20xx with a warning.
    if (opts.assumeThaiYear) return 2500 + rawYear - BUDDHIST_OFFSET;
    warnings.push('DATE_ASSUMED_GREGORIAN');
    return 2000 + rawYear;
  }
  return rawYear;
}

/** Full parse with warnings — used by the import pipeline. */
export function parseDate(raw: unknown, opts: CleanDateOptions = {}): DateParseResult {
  const field = opts.field ?? 'date';
  const warnings: SanitizationWarningCode[] = [];
  const fail = (): never => {
    throw new SanitizationError('BAD_DATE', { field });
  };

  // Excel serial: a number, or a pure-digits (optionally decimal) string.
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim()))) {
    const serial = typeof raw === 'number' ? raw : Number(raw.trim());
    if (!Number.isFinite(serial) || serial <= 0 || serial > 400_000) fail();
    const ms = EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY;
    const dt = new Date(ms);
    if (Number.isNaN(dt.getTime())) fail();
    return {
      iso: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
      warnings,
    };
  }

  if (typeof raw !== 'string') fail();
  const s = (raw as string).trim();
  if (s === '') fail();

  const parts = s.split(/[/\-.]/);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) fail();
  const nums = parts.map(Number) as [number, number, number];

  let y: number;
  let m: number;
  let d: number;
  if (parts[0]!.length === 4) {
    // year-first: YYYY-MM-DD
    [y, m, d] = nums;
  } else {
    // day-first (Thai convention): DD/MM/YYYY or DD-MM-YYYY
    [d, m, y] = nums;
  }

  y = normalizeYear(y, opts, warnings);
  if (!isValidYmd(y, m, d)) fail();

  return { iso: `${y}-${pad(m)}-${pad(d)}`, warnings };
}

/** Simple form used for manual entry (spec §7.3 signature). Returns Gregorian ISO. */
export function cleanDate(raw: unknown, opts: CleanDateOptions = {}): string {
  return parseDate(raw, opts).iso;
}
