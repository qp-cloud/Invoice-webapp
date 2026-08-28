import { SanitizationError } from './errors.js';

/**
 * Canonical SKU form (spec §7.1): trim, collapse internal whitespace runs to a single
 * space, upper-case. This is the ONLY normalizer — every manual entry and every imported
 * row passes through it, before write and before lookup, so case-insensitive uniqueness
 * holds without relying on a DB collation.
 */
export function cleanSku(raw: unknown): string {
  if (raw === null || raw === undefined) {
    throw new SanitizationError('SKU_REQUIRED', { field: 'sku' });
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new SanitizationError('SKU_REQUIRED', { field: 'sku', message: 'SKU must be text' });
  }
  const cleaned = String(raw).trim().replace(/\s+/g, ' ').toUpperCase();
  if (cleaned === '') {
    throw new SanitizationError('SKU_REQUIRED', { field: 'sku' });
  }
  return cleaned;
}
