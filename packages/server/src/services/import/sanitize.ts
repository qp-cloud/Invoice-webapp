import {
  cleanMoneySatang,
  cleanQuantity,
  cleanSku,
  parseDate,
  SanitizationError,
} from '@inventory/shared';
import type { HeaderMap, ImportKind } from './headers.js';

export interface RowError {
  field: string;
  code: string;
  level: 'error' | 'duplicate';
}
export interface RowWarning {
  field: string;
  code: string;
}
export interface SanitizedRow {
  rowNo: number;
  raw: Record<string, unknown>;
  sanitized: Record<string, unknown> | null;
  errors: RowError[];
  warnings: RowWarning[];
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

function cell(row: unknown[], map: HeaderMap, field: string): unknown {
  const idx = map.index[field];
  return idx === undefined ? undefined : row[idx];
}

function err(errors: RowError[], field: string, code: string): void {
  errors.push({ field, code, level: 'error' });
}

/** Sanitize one array-of-arrays sheet body into per-row results (spec §13.2, IMPORT_FORMAT.md §1). */
export function sanitizeRows(
  kind: ImportKind,
  map: HeaderMap,
  body: unknown[][],
): SanitizedRow[] {
  const out: SanitizedRow[] = [];

  body.forEach((row, i) => {
    const rowNo = i + 2; // sheet row (header is row 1)
    const isBlank = row.every((c) => str(c) === '');
    if (isBlank) return;

    const errors: RowError[] = [];
    const warnings: RowWarning[] = [];
    const raw: Record<string, unknown> = {};
    for (const [field, idx] of Object.entries(map.index)) raw[field] = row[idx] ?? null;

    const sanitized: Record<string, unknown> = {};

    // --- SKU (all kinds) ---
    try {
      sanitized.sku = cleanSku(cell(row, map, 'sku'));
    } catch (e) {
      if (SanitizationError.is(e)) err(errors, 'sku', e.code);
      else throw e;
    }

    if (kind === 'MASTER_STOCK') {
      sanitized.name = str(cell(row, map, 'name'));
      try {
        const q = cleanQuantity(cell(row, map, 'stock_68'), { field: 'stock_68' });
        if (q.isNegative()) err(errors, 'stock_68', 'NEGATIVE_NOT_ALLOWED');
        else sanitized.stock_68 = q.toString();
      } catch (e) {
        if (SanitizationError.is(e)) err(errors, 'stock_68', e.code);
        else throw e;
      }
      const minRaw = cell(row, map, 'min_stock');
      if (str(minRaw) === '') {
        sanitized.min_stock = '0';
      } else {
        try {
          const m = cleanQuantity(minRaw, { field: 'min_stock' });
          if (m.isNegative()) err(errors, 'min_stock', 'NEGATIVE_NOT_ALLOWED');
          else sanitized.min_stock = m.toString();
        } catch (e) {
          if (SanitizationError.is(e)) err(errors, 'min_stock', e.code);
          else throw e;
        }
      }
      const unitRaw = str(cell(row, map, 'unit'));
      sanitized.unit = unitRaw === '' ? 'piece' : unitRaw.toLowerCase();
    } else {
      // PURCHASES / SALES
      try {
        const d = parseDate(cell(row, map, 'date'), { field: 'date' });
        sanitized.date = d.iso;
        for (const w of d.warnings) warnings.push({ field: 'date', code: w });
      } catch (e) {
        if (SanitizationError.is(e)) err(errors, 'date', e.code);
        else throw e;
      }
      try {
        const q = cleanQuantity(cell(row, map, 'quantity'), { field: 'quantity' });
        if (q.lte(0)) err(errors, 'quantity', 'QUANTITY_NOT_POSITIVE');
        else sanitized.quantity = q.toString();
      } catch (e) {
        if (SanitizationError.is(e)) err(errors, 'quantity', e.code);
        else throw e;
      }
      const moneyField = kind === 'PURCHASES' ? 'unit_cost' : 'selling_price';
      try {
        sanitized[moneyField] = cleanMoneySatang(cell(row, map, moneyField), { field: moneyField });
      } catch (e) {
        if (SanitizationError.is(e)) err(errors, moneyField, e.code);
        else throw e;
      }
      sanitized.invoice_no = str(cell(row, map, 'invoice_no')) || null;
      sanitized.bill_no = str(cell(row, map, 'bill_no')) || null;
      sanitized.supplier = str(cell(row, map, 'supplier')) || null;
      sanitized.channel = str(cell(row, map, 'channel')) || null;
      sanitized.note = str(cell(row, map, 'note')) || null;
    }

    out.push({
      rowNo,
      raw,
      sanitized: errors.length === 0 ? sanitized : null,
      errors,
      warnings,
    });
  });

  return out;
}
