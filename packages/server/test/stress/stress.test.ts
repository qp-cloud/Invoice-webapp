import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Database } from '../../src/db/client.js';
import { ensurePeriod } from '../../src/services/periods.js';
import { reconcile } from '../../src/services/reconcile.js';
import { makeTestDb, usingRealPostgres } from '../helpers/testDb.js';

const TODAY = new Date().toISOString().slice(0, 10);

// Heavy — only meaningful against real Postgres with a connection pool.
describe.skipIf(!usingRealPostgres())('scale + concurrency stress (spec §21, §14.2)', () => {
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

  it('bulk-loads 2,000 products + 20,000 movements and stays reconciliation-clean', async () => {
    const period = await ensurePeriod(db, TODAY.slice(0, 7));
    const N = 2_000;
    const perProduct = 10;
    const ids: string[] = [];

    for (let start = 0; start < N; start += 500) {
      const vals: string[] = [];
      const params: unknown[] = [];
      for (let i = start; i < start + 500; i += 1) {
        const id = randomUUID();
        ids.push(id);
        const p = params.length;
        params.push(id, `STR-${String(i).padStart(5, '0')}`, `s${i}`, 'piece', 0);
        vals.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5})`);
      }
      await db.query(`INSERT INTO products (id, sku, name, unit_code, min_stock) VALUES ${vals.join(',')}`, params);
      await db.query(`INSERT INTO stock_state (product_id) SELECT unnest($1::uuid[])`, [ids.slice(start, start + 500)]);
    }

    const t0 = Date.now();
    for (let c = 0; c < ids.length; c += 200) {
      const chunk = ids.slice(c, c + 200);
      const vals: string[] = [];
      const params: unknown[] = [];
      for (const id of chunk) {
        for (let m = 0; m < perProduct; m += 1) {
          const p = params.length;
          params.push(id, m === 0 ? 'OPENING' : 'PURCHASE', '100', TODAY, period.id, 5000, m === 0 ? 'OPENING' : 'PURCHASE');
          vals.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7})`);
        }
      }
      await db.query(
        `INSERT INTO movements (product_id, type, quantity, occurred_on, period_id, unit_cost_satang, source_kind)
         VALUES ${vals.join(',')}`,
        params,
      );
    }
    const insertMs = Date.now() - t0;

    await db.query(`
      UPDATE stock_state ss SET qty_on_hand = agg.qty, total_cost_satang = agg.qty * 5000,
        avg_cost_micro = 5000 * 10000, last_nonzero_avg_micro = 5000 * 10000, last_seq = agg.max_seq
      FROM (SELECT product_id, sum(quantity) qty, max(seq) max_seq FROM movements GROUP BY product_id) agg
      WHERE ss.product_id = agg.product_id
    `);

    const count = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM movements`);
    expect(Number(count.rows[0]!.n)).toBe(N * perProduct);
    process.stdout.write(`  stress: ${N * perProduct} movements inserted in ${insertMs}ms\n`);

    const recon = await reconcile(db, { autoHeal: false });
    expect(recon.mismatches).toEqual([]);

    // server-side pagination stays correct + bounded at scale
    const page = await app.inject({ method: 'GET', url: '/api/products?page=3&pageSize=50&sort=sku' });
    expect(page.json().rows).toHaveLength(50);
    expect(page.json().total).toBeGreaterThanOrEqual(N);
  }, 120_000);

  it('25 parallel sales on one product never lose an update (ALLOW)', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/products',
      payload: { sku: `PLL-${randomUUID().slice(0, 6)}`, name: 'pll', unitCode: 'piece' },
    });
    const id = created.json().id as string;
    await app.inject({
      method: 'POST', url: '/api/openings',
      payload: { productId: id, quantity: '1000', unitCostSatang: 10000, occurredOn: TODAY },
      headers: { 'idempotency-key': randomUUID() },
    });

    const sales = Array.from({ length: 25 }, () =>
      app.inject({
        method: 'POST', url: '/api/sales',
        payload: { productId: id, quantity: '10', unitPriceSatang: 15000, occurredOn: TODAY },
        headers: { 'idempotency-key': randomUUID() },
      }),
    );
    const results = await Promise.all(sales);
    expect(results.every((r) => r.statusCode === 201)).toBe(true);

    const stock = (await app.inject({ method: 'GET', url: `/api/products/${id}/stock` })).json();
    expect(stock.qtyOnHand).toBe('750'); // 1000 - 25*10, no lost update

    const recon = await reconcile(db, { autoHeal: false });
    expect(recon.mismatches.filter((m) => m.productId === id)).toEqual([]);
  }, 60_000);
});
