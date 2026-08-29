import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import FormData from 'form-data';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

function sheetBuf(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('Excel/CSV import pipeline (spec §13, §15)', () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(async () => {
    db = await makeTestDb();
    app = await buildApp({ db });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  const upload = (kind: string, aoa: unknown[][], filename = 'f.xlsx'): Promise<{ statusCode: number; json: () => unknown }> => {
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', sheetBuf(aoa), { filename, contentType: 'application/octet-stream' });
    return app.inject({ method: 'POST', url: '/api/imports', payload: fd.getBuffer(), headers: fd.getHeaders() });
  };
  const commit = (batchId: string, body: unknown): Promise<{ statusCode: number; json: () => unknown }> =>
    app.inject({
      method: 'POST', url: `/api/imports/${batchId}/commit`, payload: body,
      headers: { 'idempotency-key': randomUUID() },
    });

  const MASTER = [
    ['sku', 'name', 'stock_68', 'min_stock', 'unit'],
    ['sku-001', 'สินค้า A', 1000, 500, 'piece'],
    ['SKU-002', 'สินค้า B', 500, 300, 'piece'],
  ];

  it('MASTER_STOCK: valid file previews then commits, creating products + openings', async () => {
    const up = await upload('MASTER_STOCK', MASTER);
    expect(up.statusCode).toBe(200);
    const preview = up.json() as { batchId: string; totals: Record<string, number>; fileAlreadyImported: boolean };
    expect(preview.fileAlreadyImported).toBe(false);
    expect(preview.totals).toMatchObject({ totalRows: 2, validRows: 2, willCreate: 2, invalidRows: 0 });

    const c = await commit(preview.batchId, { mode: 'ALL_OR_NOTHING' });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ status: 'COMMITTED', committedRows: 2, createdProducts: 2, movementsCreated: 2 });

    const a = (await app.inject({ method: 'GET', url: '/api/products?q=SKU-001' })).json();
    expect(a.rows[0].sku).toBe('SKU-001');
    expect(a.rows[0].stock.qtyOnHand).toBe('1000');
  });

  it('same file re-uploaded is flagged and its rows are DUPLICATE, applying nothing', async () => {
    const up = await upload('MASTER_STOCK', MASTER);
    const preview = up.json() as { batchId: string; fileAlreadyImported: boolean; rows: { action: string }[] };
    expect(preview.fileAlreadyImported).toBe(true);
    expect(preview.rows.every((r) => r.action === 'DUPLICATE')).toBe(true);

    const noAck = await commit(preview.batchId, { mode: 'ALL_OR_NOTHING' });
    expect(noAck.statusCode).toBe(422);
    expect((noAck.json() as { error: { code: string } }).error.code).toBe('IMPORT_FILE_ALREADY_IMPORTED');

    const up2 = await upload('MASTER_STOCK', MASTER);
    const p2 = up2.json() as { batchId: string };
    const ack = await commit(p2.batchId, { mode: 'ALL_OR_NOTHING', acknowledgeDuplicateFile: true });
    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toMatchObject({ committedRows: 0, movementsCreated: 0 });

    const count = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM products`);
    expect(count.rows[0]!.n).toBe('2');
  });

  it('PURCHASES: valid rows create purchase docs + movements', async () => {
    const aoa = [
      ['date', 'sku', 'quantity', 'unit_cost', 'invoice_no'],
      ['05/05/2569', 'SKU-001', 200, '120.00', 'PV-1'],
      ['2026-05-07', 'SKU-002', 100, 85, 'PV-2'],
    ];
    const up = await upload('PURCHASES', aoa);
    const preview = up.json() as { batchId: string; totals: Record<string, number> };
    expect(preview.totals).toMatchObject({ validRows: 2, invalidRows: 0 });

    const c = await commit(preview.batchId, { mode: 'ALL_OR_NOTHING' });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ committedRows: 2, movementsCreated: 2 });

    const a = (await app.inject({ method: 'GET', url: '/api/products?q=SKU-001' })).json();
    expect(a.rows[0].stock.qtyOnHand).toBe('1200'); // 1000 opening + 200
  });

  it('bad headers are rejected with 400 BAD_HEADERS, nothing persisted', async () => {
    const aoa = [
      ['when', 'item', 'amount', 'cost'],
      ['2026-05-01', 'SKU-001', 5, 10],
    ];
    const up = await upload('PURCHASES', aoa);
    expect(up.statusCode).toBe(400);
    const body = up.json() as { error: { code: string; details?: { code?: string } } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.code).toBe('BAD_HEADERS');
  });

  it('SALES with an unknown SKU: ALL_OR_NOTHING commit fails 422 and writes nothing', async () => {
    const before = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM sales`);
    const aoa = [
      ['date', 'sku', 'quantity', 'selling_price'],
      ['2026-05-10', 'SKU-001', 10, 150],
      ['2026-05-11', 'SKU-999', 5, 100],
    ];
    const up = await upload('SALES', aoa);
    const preview = up.json() as { batchId: string; rows: { rowNo: number; action: string; errors: { code: string }[] }[] };
    const bad = preview.rows.find((r) => r.action === 'SKIP');
    expect(bad?.errors.some((e) => e.code === 'SKU_NOT_FOUND')).toBe(true);

    const c = await commit(preview.batchId, { mode: 'ALL_OR_NOTHING' });
    expect(c.statusCode).toBe(422);
    expect((c.json() as { error: { code: string } }).error.code).toBe('IMPORT_HAS_INVALID_ROWS');

    const after = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM sales`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('mixed invalid rows: PARTIAL commits the valid ones and lists the skipped', async () => {
    const aoa = [
      ['date', 'sku', 'quantity', 'unit_cost'],
      ['2026-05-12', 'SKU-001', 5, 10], // valid
      ['2026-05-13', 'SKU-001', 'abc', 10], // NOT_A_NUMBER
      ['not-a-date', 'SKU-001', 5, 10], // BAD_DATE
      ['2026-05-14', 'SKU-001', 0, 10], // QUANTITY_NOT_POSITIVE
      ['2026-05-15', 'SKU-001', '1.2345', 10], // QUANTITY_PRECISION
    ];
    const up = await upload('PURCHASES', aoa);
    const preview = up.json() as { batchId: string; totals: Record<string, number> };
    expect(preview.totals).toMatchObject({ validRows: 1, invalidRows: 4 });

    const c = await commit(preview.batchId, { mode: 'PARTIAL' });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({ committedRows: 1, skippedRows: 4 });

    const dl = await app.inject({ method: 'GET', url: `/api/imports/${preview.batchId}/invalid-rows.xlsx` });
    expect(dl.statusCode).toBe(200);
    const wb = XLSX.read(dl.rawPayload, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!);
    expect(rows).toHaveLength(4);
    expect(String(rows[0]!._error)).toMatch(/NOT_A_NUMBER|BAD_DATE|QUANTITY/);
  });

  it('row-level dedup: identical rows commit once; a corrected re-upload only lands new rows', async () => {
    const aoa = [
      ['date', 'sku', 'quantity', 'unit_cost'],
      ['2026-06-01', 'SKU-002', 7, 50],
      ['2026-06-01', 'SKU-002', 7, 50],
    ];
    const first = await upload('PURCHASES', aoa, 'dup-a.xlsx');
    const fp = first.json() as { batchId: string };
    const fc = await commit(fp.batchId, { mode: 'ALL_OR_NOTHING' });
    // two identical rows are both valid the first time round
    expect(fc.json()).toMatchObject({ committedRows: 2, movementsCreated: 2 });

    // re-upload = same two rows (now committed -> DUPLICATE) + one genuinely new row
    const aoa2 = [...aoa, ['2026-06-02', 'SKU-002', 9, 50]];
    const second = await upload('PURCHASES', aoa2, 'dup-b.xlsx');
    const sp = second.json() as { batchId: string; rows: { action: string }[]; totals: Record<string, number> };
    expect(sp.rows.filter((r) => r.action === 'DUPLICATE')).toHaveLength(2);
    expect(sp.totals.willCreate).toBe(1);
    const sc = await commit(sp.batchId, { mode: 'ALL_OR_NOTHING' });
    expect(sc.json()).toMatchObject({ committedRows: 1, skippedRows: 2, movementsCreated: 1 });
  });

  it('exports return .xlsx buffers for every kind', async () => {
    for (const [url, col] of [
      ['/api/exports/current-stock.xlsx', 'sku'],
      ['/api/exports/purchases.xlsx', 'sku'],
      ['/api/exports/sales.xlsx', 'sku'],
      ['/api/exports/low-stock.xlsx', 'sku'],
      ['/api/exports/oversold.xlsx', 'sku'],
      ['/api/exports/monthly-report.xlsx?ym=2026-05', 'sku'],
    ] as const) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      const wb = XLSX.read(res.rawPayload, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!);
      if (rows.length > 0) expect(Object.keys(rows[0]!)).toContain(col);
    }
  });
});
