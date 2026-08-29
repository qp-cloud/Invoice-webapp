import { AppError } from '@inventory/shared';

export type ImportKind = 'MASTER_STOCK' | 'PURCHASES' | 'SALES';
export const IMPORT_KINDS: ImportKind[] = ['MASTER_STOCK', 'PURCHASES', 'SALES'];

/** Canonical field -> accepted header aliases (IMPORT_FORMAT.md §2-4). Matched case-insensitively, trimmed. */
type FieldSpec = { field: string; required: 'always' | 'on-create' | 'never'; aliases: string[] };

const SPECS: Record<ImportKind, FieldSpec[]> = {
  MASTER_STOCK: [
    { field: 'sku', required: 'always', aliases: ['sku', 'รหัสสินค้า', 'code', 'product_code'] },
    { field: 'name', required: 'on-create', aliases: ['name', 'ชื่อสินค้า', 'product_name', 'description'] },
    {
      field: 'stock_68',
      required: 'always',
      aliases: ['stock_68', 'stock68', 'opening', 'opening_stock', 'ยอดยกมา', 'สต็อก68'],
    },
    {
      field: 'min_stock',
      required: 'never',
      aliases: ['min_stock', 'minstock', 'min', 'safety_stock', 'ขั้นต่ำ'],
    },
    { field: 'unit', required: 'never', aliases: ['unit', 'หน่วย', 'uom'] },
  ],
  PURCHASES: [
    { field: 'date', required: 'always', aliases: ['date', 'วันที่', 'doc_date', 'purchase_date'] },
    { field: 'sku', required: 'always', aliases: ['sku', 'รหัสสินค้า', 'code'] },
    { field: 'quantity', required: 'always', aliases: ['quantity', 'qty', 'จำนวน'] },
    {
      field: 'unit_cost',
      required: 'always',
      aliases: ['unit_cost', 'cost', 'price', 'ราคาทุน', 'ต้นทุนต่อหน่วย'],
    },
    { field: 'invoice_no', required: 'never', aliases: ['invoice_no', 'invoice', 'เลขที่บิล', 'เลขที่ใบกำกับ'] },
    { field: 'supplier', required: 'never', aliases: ['supplier', 'ผู้ขาย', 'vendor'] },
    { field: 'note', required: 'never', aliases: ['note', 'หมายเหตุ', 'remark'] },
  ],
  SALES: [
    { field: 'date', required: 'always', aliases: ['date', 'วันที่', 'doc_date', 'sale_date'] },
    { field: 'sku', required: 'always', aliases: ['sku', 'รหัสสินค้า', 'code'] },
    { field: 'quantity', required: 'always', aliases: ['quantity', 'qty', 'จำนวน', 'จำนวนขาย'] },
    {
      field: 'selling_price',
      required: 'always',
      aliases: ['selling_price', 'price', 'unit_price', 'ราคาขาย'],
    },
    { field: 'channel', required: 'never', aliases: ['channel', 'ช่องทาง', 'sales_channel'] },
    { field: 'bill_no', required: 'never', aliases: ['bill_no', 'bill', 'เลขที่บิล', 'receipt_no'] },
    { field: 'note', required: 'never', aliases: ['note', 'หมายเหตุ', 'remark'] },
  ],
};

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, '_');

export interface HeaderMap {
  /** canonical field -> column index in the sheet */
  index: Record<string, number>;
}

/**
 * Resolve the sheet's header row to canonical fields. Throws VALIDATION_FAILED with the
 * list of unmatched required headers (IMPORT_FORMAT.md §5, spec §13.2).
 */
export function resolveHeaders(headerRow: string[], kind: ImportKind): HeaderMap {
  const normalized = headerRow.map((h) => norm(String(h ?? '')));
  const index: Record<string, number> = {};
  for (const spec of SPECS[kind]) {
    const col = normalized.findIndex((h) => spec.aliases.some((a) => norm(a) === h));
    if (col >= 0) index[spec.field] = col;
  }
  const missing = SPECS[kind]
    .filter((s) => s.required === 'always' && index[s.field] === undefined)
    .map((s) => s.field);
  if (missing.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `หัวคอลัมน์ไม่ถูกต้อง ขาด: ${missing.join(', ')}`,
      details: { code: 'BAD_HEADERS', missing, kind },
    });
  }
  return { index };
}
