import { AppError } from '@inventory/shared';
import type { Database } from '../../db/client.js';
import { fileHash, rowHash } from './hash.js';
import { resolveHeaders, type ImportKind } from './headers.js';
import { parseWorkbook } from './parse.js';
import { sanitizeRows, type RowError, type SanitizedRow } from './sanitize.js';

export type RowAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'DUPLICATE';

export interface PreviewRow {
  rowNo: number;
  action: RowAction;
  sanitized: Record<string, unknown> | null;
  errors: RowError[];
  warnings: { field: string; code: string }[];
}

export interface ImportPreview {
  batchId: string;
  kind: ImportKind;
  fileAlreadyImported: boolean;
  totals: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    willCreate: number;
    willUpdate: number;
  };
  rows: PreviewRow[];
}

interface EvaluatedRow extends SanitizedRow {
  action: RowAction;
  hash: string | null;
}

async function evaluate(
  db: Database,
  kind: ImportKind,
  rows: SanitizedRow[],
): Promise<EvaluatedRow[]> {
  // SKU -> product id (+ existence) for the whole catalogue
  const prod = await db.query<{ id: string; sku: string }>('SELECT id, sku FROM products');
  const skuToId = new Map(prod.rows.map((r) => [r.sku, r.id]));

  const unitRows = await db.query<{ code: string }>('SELECT code FROM units');
  const knownUnits = new Set(unitRows.rows.map((r) => r.code));

  // closed periods referenced by the file
  const yms = new Set<string>();
  for (const r of rows) {
    const d = r.sanitized?.date;
    if (typeof d === 'string') yms.add(d.slice(0, 7));
  }
  const closed = new Set<string>();
  if (yms.size > 0) {
    const p = await db.query<{ ym: string }>(
      `SELECT ym FROM periods WHERE status = 'CLOSED' AND ym = ANY($1)`,
      [[...yms]],
    );
    for (const row of p.rows) closed.add(row.ym);
  }

  // row hashes already committed for this kind
  const hashes = rows
    .filter((r) => r.sanitized)
    .map((r) => rowHash(kind, r.sanitized as Record<string, unknown>));
  const committed = new Set<string>();
  if (hashes.length > 0) {
    const h = await db.query<{ source_row_hash: string }>(
      `SELECT ir.source_row_hash
       FROM import_rows ir
       JOIN import_batches ib ON ib.id = ir.batch_id
       WHERE ir.committed AND ib.kind = $1 AND ir.source_row_hash = ANY($2)`,
      [kind, hashes],
    );
    for (const row of h.rows) committed.add(row.source_row_hash);
  }

  const seenSku = new Set<string>();
  const out: EvaluatedRow[] = [];

  for (const r of rows) {
    const errors = [...r.errors];
    let hash: string | null = null;
    let action: RowAction = 'CREATE';

    if (r.sanitized) {
      const s = r.sanitized;
      const sku = String(s.sku);
      hash = rowHash(kind, s);

      if (kind === 'MASTER_STOCK') {
        if (seenSku.has(sku)) errors.push({ field: 'sku', code: 'DUPLICATE_SKU_IN_FILE', level: 'error' });
        seenSku.add(sku);
        const exists = skuToId.has(sku);
        if (!exists && String(s.name ?? '') === '') {
          errors.push({ field: 'name', code: 'NAME_REQUIRED_ON_CREATE', level: 'error' });
        }
        const unit = String(s.unit ?? 'piece');
        if (unit !== 'piece' && !knownUnits.has(unit)) {
          r.warnings.push({ field: 'unit', code: 'UNKNOWN_UNIT' }); // falls back to 'piece' on commit
        }
        action = exists ? 'UPDATE' : 'CREATE';
      } else {
        if (!skuToId.has(sku)) errors.push({ field: 'sku', code: 'SKU_NOT_FOUND', level: 'error' });
        const ym = String(s.date).slice(0, 7);
        if (closed.has(ym)) errors.push({ field: 'date', code: 'PERIOD_CLOSED', level: 'error' });
        action = 'CREATE';
      }

      if (errors.length === 0 && committed.has(hash)) {
        action = 'DUPLICATE';
        errors.push({ field: '_row', code: 'ROW_ALREADY_IMPORTED', level: 'duplicate' });
      }
    }

    if (errors.some((e) => e.level === 'error')) action = 'SKIP';

    out.push({ ...r, errors, action, hash });
  }

  return out;
}

/** UPLOAD -> PARSE -> SANITIZE -> VALIDATE -> DUPLICATE CHECK -> PREVIEW (no writes to ledger). */
export async function createImport(
  db: Database,
  input: { kind: ImportKind; filename: string; buffer: Buffer },
): Promise<ImportPreview> {
  const { header, body } = parseWorkbook(input.buffer);
  const map = resolveHeaders(header, input.kind);
  const sanitized = sanitizeRows(input.kind, map, body);

  const srcFileHash = fileHash(input.buffer);
  const dupFile = await db.query(
    `SELECT 1 FROM import_batches WHERE source_file_hash = $1 AND status = 'COMMITTED' LIMIT 1`,
    [srcFileHash],
  );
  const fileAlreadyImported = dupFile.rows.length > 0;

  const evaluated = await evaluate(db, input.kind, sanitized);

  const totals = {
    totalRows: evaluated.length,
    validRows: evaluated.filter((r) => r.action === 'CREATE' || r.action === 'UPDATE').length,
    invalidRows: evaluated.filter((r) => r.action === 'SKIP').length,
    duplicateRows: evaluated.filter((r) => r.action === 'DUPLICATE').length,
    willCreate: evaluated.filter((r) => r.action === 'CREATE').length,
    willUpdate: evaluated.filter((r) => r.action === 'UPDATE').length,
  };

  const batchId = await db.transaction(async (tx) => {
    const b = await tx.query<{ id: string }>(
      `INSERT INTO import_batches
         (kind, filename, source_file_hash, row_count, valid_count, invalid_count,
          duplicate_count, create_count, update_count, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PREVIEW')
       RETURNING id`,
      [
        input.kind, input.filename, srcFileHash, totals.totalRows, totals.validRows,
        totals.invalidRows, totals.duplicateRows, totals.willCreate, totals.willUpdate,
      ],
    );
    const id = b.rows[0]!.id;
    for (const r of evaluated) {
      await tx.query(
        `INSERT INTO import_rows (batch_id, row_no, raw, sanitized, errors, source_row_hash, action)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id, r.rowNo, JSON.stringify(r.raw),
          r.sanitized ? JSON.stringify(r.sanitized) : null,
          JSON.stringify(r.errors),
          r.hash ?? `row-${r.rowNo}`,
          r.action,
        ],
      );
    }
    return id;
  });

  return {
    batchId,
    kind: input.kind,
    fileAlreadyImported,
    totals,
    rows: evaluated.map((r) => ({
      rowNo: r.rowNo,
      action: r.action,
      sanitized: r.sanitized,
      errors: r.errors,
      warnings: r.warnings,
    })),
  };
}

export interface FetchPreviewOptions {
  invalidOnly?: boolean;
}

export async function getImportPreview(
  db: Database,
  batchId: string,
  opts: FetchPreviewOptions = {},
): Promise<ImportPreview> {
  const b = await db.query<{
    id: string;
    kind: ImportKind;
    source_file_hash: string;
    status: string;
    row_count: number;
    valid_count: number;
    invalid_count: number;
    duplicate_count: number;
    create_count: number;
    update_count: number;
  }>(`SELECT * FROM import_batches WHERE id = $1`, [batchId]);
  if (!b.rows[0]) {
    throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบรายการนำเข้า' });
  }
  const batch = b.rows[0];

  const dupFile = await db.query(
    `SELECT 1 FROM import_batches
     WHERE source_file_hash = $1 AND status = 'COMMITTED' AND id <> $2 LIMIT 1`,
    [batch.source_file_hash, batchId],
  );

  const where = opts.invalidOnly ? `AND action = 'SKIP'` : '';
  const rows = await db.query<{
    row_no: number;
    action: RowAction;
    sanitized: Record<string, unknown> | null;
    errors: RowError[];
  }>(
    `SELECT row_no, action, sanitized, errors FROM import_rows
     WHERE batch_id = $1 ${where} ORDER BY row_no`,
    [batchId],
  );

  return {
    batchId,
    kind: batch.kind,
    fileAlreadyImported: dupFile.rows.length > 0,
    totals: {
      totalRows: batch.row_count,
      validRows: batch.valid_count,
      invalidRows: batch.invalid_count,
      duplicateRows: batch.duplicate_count,
      willCreate: batch.create_count,
      willUpdate: batch.update_count,
    },
    rows: rows.rows.map((r) => ({
      rowNo: r.row_no,
      action: r.action,
      sanitized: r.sanitized,
      errors: r.errors ?? [],
      warnings: [],
    })),
  };
}

export async function discardImport(db: Database, batchId: string): Promise<{ status: string }> {
  const r = await db.query(
    `UPDATE import_batches SET status = 'DISCARDED' WHERE id = $1 AND status = 'PREVIEW'`,
    [batchId],
  );
  if ((r.affectedRows ?? 0) === 0) {
    throw new AppError('CONFLICT', {
      userMessage: 'ยกเลิกรายการนำเข้านี้ไม่ได้',
    });
  }
  return { status: 'DISCARDED' };
}
