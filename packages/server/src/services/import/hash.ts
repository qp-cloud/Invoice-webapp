import { createHash } from 'node:crypto';
import type { ImportKind } from './headers.js';

/** sha256 of the uploaded bytes (spec §15). */
export function fileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** The business fields that identify a row for row-level dedup, per kind (IMPORT_FORMAT.md §6). */
const HASH_FIELDS: Record<ImportKind, string[]> = {
  MASTER_STOCK: ['sku', 'stock_68', 'min_stock', 'unit', 'unit_cost', 'name'],
  PURCHASES: ['date', 'sku', 'quantity', 'unit_cost', 'invoice_no', 'supplier', 'note'],
  SALES: ['date', 'sku', 'quantity', 'selling_price', 'channel', 'bill_no', 'note'],
};

/**
 * sha256 of the canonicalized sanitized row (kind + normalized business fields). Stable
 * across column order and cosmetic differences because it is built from sanitized values.
 */
export function rowHash(kind: ImportKind, sanitized: Record<string, unknown>): string {
  const canonical = HASH_FIELDS[kind]
    .map((f) => `${f}=${sanitized[f] ?? ''}`)
    .join('');
  return createHash('sha256').update(`${kind}${canonical}`).digest('hex');
}
