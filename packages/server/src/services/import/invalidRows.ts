import { AppError } from '@inventory/shared';
import * as XLSX from 'xlsx';
import type { Database } from '../../db/client.js';
import type { RowError } from './sanitize.js';

/**
 * Invalid rows as an .xlsx buffer, same layout as the source plus a trailing `_error`
 * column (spec §13.6, IMPORT_FORMAT.md §5).
 */
export async function invalidRowsWorkbook(db: Database, batchId: string): Promise<Buffer> {
  const b = await db.query<{ kind: string }>('SELECT kind FROM import_batches WHERE id = $1', [batchId]);
  if (!b.rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบรายการนำเข้า' });

  const rows = await db.query<{ row_no: number; raw: Record<string, unknown>; errors: RowError[] }>(
    `SELECT row_no, raw, errors FROM import_rows
     WHERE batch_id = $1 AND action = 'SKIP' ORDER BY row_no`,
    [batchId],
  );

  const cols = new Set<string>();
  for (const r of rows.rows) for (const k of Object.keys(r.raw ?? {})) cols.add(k);
  const header = [...cols];

  const aoa: unknown[][] = [[...header, '_error']];
  for (const r of rows.rows) {
    const errText = (r.errors ?? [])
      .filter((e) => e.level === 'error')
      .map((e) => `${e.field}:${e.code}`)
      .join('; ');
    aoa.push([...header.map((h) => r.raw?.[h] ?? ''), errText]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'invalid');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
