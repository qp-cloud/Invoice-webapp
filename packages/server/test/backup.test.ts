import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetConfigCache } from '../src/config.js';
import type { Database } from '../src/db/client.js';
import {
  backupOverdue,
  createBackup,
  deleteBackup,
  restoreBackup,
} from '../src/services/backup.js';
import { makeTestDb } from './helpers/testDb.js';

const TODAY = new Date().toISOString().slice(0, 10);
const PASS = 'test-passphrase-123';

describe('backup + restore (spec §16)', () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(async () => {
    process.env.BACKUP_DIR = mkdtempSync(join(tmpdir(), 'inv-bak-'));
    process.env.BACKUP_PASSPHRASE = PASS;
    resetConfigCache();
    db = await makeTestDb();
    app = await buildApp({ db });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.close();
    delete process.env.BACKUP_DIR;
    delete process.env.BACKUP_PASSPHRASE;
    resetConfigCache();
  });

  const post = (url: string, payload: unknown): Promise<{ statusCode: number; json: () => unknown }> =>
    app.inject({ method: 'POST', url, payload, headers: { 'idempotency-key': randomUUID() } });
  const seed = async (): Promise<string> => {
    const p = await app.inject({
      method: 'POST', url: '/api/products',
      payload: { sku: `BK-${randomUUID().slice(0, 6)}`, name: 'bk', unitCode: 'piece' },
    });
    const id = p.json().id as string;
    await post('/api/openings', { productId: id, quantity: '100', unitCostSatang: 10000, occurredOn: TODAY });
    await post('/api/purchases', { productId: id, quantity: '25', unitCostSatang: 12000, occurredOn: TODAY });
    await post('/api/sales', { productId: id, quantity: '40', unitPriceSatang: 20000, occurredOn: TODAY });
    return id;
  };

  it('backup -> destroy data -> restore -> golden query matches', async () => {
    const productId = await seed();
    const before = (await app.inject({ method: 'GET', url: `/api/products/${productId}/stock` })).json();
    expect(before.qtyOnHand).toBe('85'); // 100 + 25 - 40

    const b = await createBackup(db, { kind: 'MANUAL', passphrase: PASS });
    expect(b.localStatus).toBe('LOCAL_BACKUP_SUCCESS');
    expect(b.verifiedAt).not.toBeNull();
    expect(b.rowCounts.products).toBeGreaterThan(0);

    // wreck the database
    await db.query('DELETE FROM movements');
    await db.query('UPDATE stock_state SET qty_on_hand = 0, total_cost_satang = 0');
    await db.query('DELETE FROM sales');
    const wrecked = (await app.inject({ method: 'GET', url: `/api/products/${productId}/stock` })).json();
    expect(wrecked.qtyOnHand).toBe('0');

    const res = await restoreBackup(db, b.id, { passphrase: PASS, confirm: 'RESTORE' });
    expect(res.restoredFrom).toBe(b.id);
    expect(res.preRestoreBackupId).toBeTruthy();

    const after = (await app.inject({ method: 'GET', url: `/api/products/${productId}/stock` })).json();
    expect(after.qtyOnHand).toBe('85');
    const sales = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM sales`);
    expect(Number(sales.rows[0]!.n)).toBeGreaterThan(0);

    // a fresh movement still posts (identity sequence intact after restore)
    const p2 = await post('/api/purchases', { productId, quantity: '5', unitCostSatang: 12000, occurredOn: TODAY });
    expect(p2.statusCode).toBe(201);
  });

  it('sets settings.last_backup_at and clears the overdue flag', async () => {
    expect(await backupOverdue(db, 24)).toBe(false);
    const s = await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'last_backup_at'`);
    expect(s.rows[0]).toBeTruthy();
  });

  it('a tampered artifact is refused with BACKUP_INTEGRITY_FAILED', async () => {
    await seed();
    const b = await createBackup(db, { passphrase: PASS });
    const meta = await db.query<{ p: string }>(`SELECT artifact_path AS p FROM backups WHERE id = $1`, [b.id]);
    const buf = readFileSync(meta.rows[0]!.p);
    buf[buf.length - 5] ^= 0xff;
    writeFileSync(meta.rows[0]!.p, buf);

    await expect(restoreBackup(db, b.id, { passphrase: PASS, confirm: 'RESTORE' })).rejects.toMatchObject({
      code: 'BACKUP_INTEGRITY_FAILED',
    });
  });

  it('the wrong passphrase is rejected with BAD_PASSPHRASE', async () => {
    const b = await createBackup(db, { passphrase: PASS });
    await expect(
      restoreBackup(db, b.id, { passphrase: 'not-the-passphrase', confirm: 'RESTORE' }),
    ).rejects.toMatchObject({ code: 'BAD_PASSPHRASE' });
  });

  it('a backup with a newer schema than the app is refused', async () => {
    const b = await createBackup(db, { passphrase: PASS });
    await db.query(`UPDATE backups SET schema_version = '9999_future' WHERE id = $1`, [b.id]);
    await expect(
      restoreBackup(db, b.id, { passphrase: PASS, confirm: 'RESTORE' }),
    ).rejects.toMatchObject({ code: 'SCHEMA_NEWER_THAN_APP' });
  });

  it('restore without the confirm phrase is rejected', async () => {
    const b = await createBackup(db, { passphrase: PASS });
    await expect(
      restoreBackup(db, b.id, { passphrase: PASS, confirm: 'yes' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('deleting the last verified copy is blocked (LAST_REMAINING_COPY)', async () => {
    // remove every existing backup except we keep exactly one, then try to delete it
    const all = (await db.query<{ id: string }>(`SELECT id FROM backups ORDER BY created_at`)).rows;
    for (const row of all.slice(0, -1)) {
      await db.query(`DELETE FROM backups WHERE id = $1`, [row.id]);
    }
    const lastId = all[all.length - 1]!.id;
    await expect(deleteBackup(db, lastId)).rejects.toMatchObject({ code: 'LAST_REMAINING_COPY' });
  });

  it('POST /api/backups then GET /api/backups/status via HTTP', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/backups', payload: { passphrase: PASS },
    });
    expect(created.statusCode).toBe(201);
    const status = await app.inject({ method: 'GET', url: '/api/backups/status' });
    const body = status.json();
    expect(body.verifiedCount).toBeGreaterThan(0);
    expect(body.lastBackupAt).toBeTruthy();
  });
});
