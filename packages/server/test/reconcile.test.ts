import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { reconcile } from '../src/services/reconcile.js';
import { makeTestDb } from './helpers/testDb.js';

const TODAY = new Date().toISOString().slice(0, 10);

describe('reconciliation job (spec §21)', () => {
  let app: FastifyInstance;
  let db: Database;
  let productId: string;

  beforeAll(async () => {
    db = await makeTestDb();
    app = await buildApp({ db });
    await app.ready();
    const p = await app.inject({
      method: 'POST', url: '/api/products',
      payload: { sku: 'RC-1', name: 'rc', unitCode: 'piece' },
    });
    productId = p.json().id as string;
    const post = (url: string, payload: unknown): Promise<unknown> =>
      app.inject({ method: 'POST', url, payload, headers: { 'idempotency-key': randomUUID() } });
    await post('/api/openings', { productId, quantity: '100', unitCostSatang: 10000, occurredOn: TODAY });
    await post('/api/purchases', { productId, quantity: '30', unitCostSatang: 12000, occurredOn: TODAY });
    await post('/api/sales', { productId, quantity: '40', unitPriceSatang: 20000, occurredOn: TODAY });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('reports no drift for a healthy cache', async () => {
    const r = await reconcile(db, { autoHeal: false });
    expect(r.mismatches).toEqual([]);
    expect(r.checkedProducts).toBe(1);
  });

  it('detects a corrupted stock_state row without healing when autoHeal is false', async () => {
    await db.query(`UPDATE stock_state SET qty_on_hand = 999 WHERE product_id = $1`, [productId]);
    const r = await reconcile(db, { autoHeal: false });
    expect(r.mismatches.map((m) => m.field)).toContain('qtyOnHand');
    const m = r.mismatches.find((x) => x.field === 'qtyOnHand')!;
    expect(m.cached).toBe('999');
    expect(m.computed).toBe('90'); // 100 + 30 - 40
    expect(r.healed).toEqual([]);

    const still = await db.query<{ q: string }>(
      `SELECT qty_on_hand::text AS q FROM stock_state WHERE product_id = $1`, [productId],
    );
    expect(Number(still.rows[0]!.q)).toBe(999);
  });

  it('heals the cache from the ledger when autoHeal is true', async () => {
    const r = await reconcile(db, { autoHeal: true });
    expect(r.healed).toContain(productId);
    const fixed = await db.query<{ q: string }>(
      `SELECT qty_on_hand::text AS q FROM stock_state WHERE product_id = $1`, [productId],
    );
    expect(Number(fixed.rows[0]!.q)).toBe(90);

    const clean = await reconcile(db, { autoHeal: false });
    expect(clean.mismatches).toEqual([]);
  });

  it('POST /api/reconcile runs over HTTP', async () => {
    await db.query(`UPDATE stock_state SET total_cost_satang = 1 WHERE product_id = $1`, [productId]);
    const res = await app.inject({ method: 'POST', url: '/api/reconcile', payload: { autoHeal: true } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.healed).toContain(productId);
    expect(body.checkedProducts).toBe(1);
  });
});
