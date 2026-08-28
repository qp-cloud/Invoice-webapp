import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../../src/db/client.js';
import { currentSchemaVersion, runMigrations } from '../../src/db/migrate.js';

describe('migrations', () => {
  let db: Database;

  beforeAll(async () => {
    db = createDb({ dataDir: 'memory' });
  });
  afterAll(async () => {
    await db.close();
  });

  it('applies all migrations and is idempotent', async () => {
    const first = await runMigrations(db);
    expect(first).toEqual(['0001_init', '0002_seed', '0003_periods_fy2569']);

    const second = await runMigrations(db);
    expect(second).toEqual([]);

    expect(await currentSchemaVersion(db)).toBe('0003_periods_fy2569');
  });

  it('created the core tables', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'settings', 'categories', 'units', 'products', 'periods', 'movements',
      'purchases', 'sales', 'returns', 'adjustments', 'stock_state', 'recon_alerts',
      'audit_log', 'processed_requests', 'import_batches', 'import_rows', 'backups',
      '_migrations',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('seeded settings and units', async () => {
    const s = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
    const map = Object.fromEntries(s.rows.map((r) => [r.key, r.value]));
    expect(map.negative_stock_mode).toBe('ALLOW');
    expect(map.current_fiscal_year).toBe(2569);
    expect(map.thai_dates).toBe(true);

    const u = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM units');
    expect(Number(u.rows[0]?.n)).toBeGreaterThanOrEqual(10);
  });

  it('seeded 12 open periods for FY2569', async () => {
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM periods WHERE status = 'OPEN' AND ym LIKE '2026-%'`,
    );
    expect(rows[0]?.n).toBe('12');
  });

  it('enforces the movements sign check', async () => {
    // insert a product to reference
    await db.query(
      `INSERT INTO products (id, sku, name, unit_code) VALUES
       ('11111111-1111-1111-1111-111111111111', 'SKU-X', 'x', 'piece')`,
    );
    const period = await db.query<{ id: string }>(
      `SELECT id FROM periods WHERE ym = '2026-01'`,
    );
    const pid = period.rows[0]!.id;
    // SALE with positive quantity must be rejected by mov_sign_ck
    await expect(
      db.query(
        `INSERT INTO movements (product_id, type, quantity, occurred_on, period_id, source_kind)
         VALUES ('11111111-1111-1111-1111-111111111111', 'SALE', 5, '2026-01-10', $1, 'SALE')`,
        [pid],
      ),
    ).rejects.toThrow();
  });
});
