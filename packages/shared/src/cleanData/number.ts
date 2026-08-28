import { Decimal } from 'decimal.js';
import '../money/decimal.js'; // shared Decimal config
import { type Satang, toSatang } from '../money/satang.js';
import { SanitizationError } from './errors.js';

const CURRENCY = /[฿$]|THB|บาท/gi;

/**
 * Normalize a human/spreadsheet number string to a plain decimal string (spec §7.2):
 *   "1,250.00" | "฿1,250.00" | " 1,250.00 ฿" | "1 250.00" | "1250" -> "1250.00" / "1250"
 *   "(1,250.00)" -> "-1250.00"  (parenthesised negative)
 * Throws NOT_A_NUMBER for empty / non-numeric / NaN / Infinity.
 */
export function normalizeNumberString(raw: unknown, field?: string): string {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new SanitizationError('NOT_A_NUMBER', { field });
    return String(raw);
  }
  if (typeof raw !== 'string') {
    throw new SanitizationError('NOT_A_NUMBER', { field });
  }

  let s = raw.trim();
  if (s === '') throw new SanitizationError('NOT_A_NUMBER', { field });

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  s = s
    .replace(CURRENCY, '')
    .replace(/−/g, '-') // unicode minus
    .replace(/[\s,]/g, '') // thousands separators: space or comma
    .trim();

  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (negative) s = `-${s}`;

  if (s === '' || s === '-' || !/^-?\d*\.?\d+$/.test(s)) {
    throw new SanitizationError('NOT_A_NUMBER', { field });
  }
  return s;
}

/** Parse to a finite Decimal, or throw NOT_A_NUMBER. */
function toFiniteDecimal(raw: unknown, field?: string): Decimal {
  const normalized = normalizeNumberString(raw, field);
  let d: Decimal;
  try {
    d = new Decimal(normalized);
  } catch {
    throw new SanitizationError('NOT_A_NUMBER', { field });
  }
  if (!d.isFinite()) throw new SanitizationError('NOT_A_NUMBER', { field });
  return d;
}

export interface CleanQuantityOptions {
  field?: string;
  /** default 3 (spec §7.2 / DATABASE.md numeric(18,3)) */
  maxDecimalPlaces?: number;
}

/** Quantity: fractional allowed, at most 3 dp. Sign is left to the caller to police. */
export function cleanQuantity(raw: unknown, opts: CleanQuantityOptions = {}): Decimal {
  const field = opts.field ?? 'quantity';
  const max = opts.maxDecimalPlaces ?? 3;
  const d = toFiniteDecimal(raw, field);
  if (d.decimalPlaces() > max) {
    throw new SanitizationError('QUANTITY_PRECISION', {
      field,
      message: `quantity has more than ${max} decimal places`,
    });
  }
  return d;
}

export interface CleanMoneyOptions {
  field?: string;
  /** allow a negative amount (e.g. signed adjustment value). Default false. */
  allowNegative?: boolean;
}

/** Money → integer satang, round-half-up to 2dp (spec §7.2, §9.1, §26.1 #5). */
export function cleanMoneySatang(raw: unknown, opts: CleanMoneyOptions = {}): Satang {
  const field = opts.field ?? 'amount';
  const d = toFiniteDecimal(raw, field);
  if (d.isNegative() && !opts.allowNegative) {
    throw new SanitizationError('NEGATIVE_NOT_ALLOWED', { field });
  }
  return toSatang(d);
}
