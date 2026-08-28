import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

/**
 * Spec §14.2 concurrency scenarios. PGlite is single-connection so these exercise the
 * SERIALIZED path and the guard/idempotency logic; the genuine multi-client
 * "no lost update" assertion is deferred to a real Postgres run (TESTING.md §3.5,
 * spec Change Log v0.3).
 */
const TODAY = new Date().toISOString().slice(0, 10);

describe('concurrency (serialized under PGlite)', () => {
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

  const newProduct = async (sku: string): Promise<string> => {
    const r = await app.inject({
      method: 'POST', url: '/api/products',
      payload: { sku, name: sku, unitCode: 'piece' },
    });
    return r.json().id as string;
  };
  const post = (url: string, payload: unknown, key = randomUUID()) =>
    app.inject({ method: 'POST', url, payload, headers: { 'idempotency-key': key } });
  const openTo = (id: string, qty: string) =>
    post('/api/openings', { productId: id, quantity: qty, unitCostSatang: 10000, occurredOn: TODAY });
  const sell = (id: string, qty: string) =>
    post('/api/sales', { productId: id, quantity: qty, unitPriceSatang: 12000, occurredOn: TODAY });

  it('ALLOW: A sells 80 and B sells 50 from 100 -> both succeed, final -30, no lost update', async () => {
    const id = await newProduct('CC-ALLOW');
    await openTo(id, '100');
    const [a, b] = await Promise.all([sell(id, '80'), sell(id, '50')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 201]);

    const stock = (await app.inject({ method: 'GET', url: `/api/products/${id}/stock` })).json();
    expect(stock.qtyOnHand).toBe('-30');
    expect(stock.oversold).toBe(true);

    const mv = await db.query<{ n: string; s: string }>(
      `SELECT count(*)::text AS n, COALESCE(sum(quantity),0)::text AS s
       FROM movements WHERE product_id=$1 AND type='SALE'`, [id],
    );
    expect(mv.rows[0]?.n).toBe('2');
    expect(Number(mv.rows[0]?.s)).toBe(-130);
  });

  it('PREVENT: A sells 80 and B sells 50 from 100 -> exactly one succeeds, final 20', async () => {
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { negative_stock_mode: 'PREVENT' } });
    const id = await newProduct('CC-PREVENT');
    await openTo(id, '100');
    const [a, b] = await Promise.all([sell(id, '80'), sell(id, '50')]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 422]);

    const stock = (await app.inject({ method: 'GET', url: `/api/products/${id}/stock` })).json();
    expect(stock.qtyOnHand).toBe('20');
    const sales = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales WHERE product_id=$1`, [id],
    );
    expect(sales.rows[0]?.n).toBe('1');
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { negative_stock_mode: 'ALLOW' } });
  });

  it('idempotency under parallel retries: 5x same key -> one sale row', async () => {
    const id = await newProduct('CC-IDEM');
    await openTo(id, '100');
    const key = randomUUID();
    const body = { productId: id, quantity: '10', unitPriceSatang: 12000, occurredOn: TODAY };
    const results = await Promise.all(Array.from({ length: 5 }, () => post('/api/sales', body, key)));
    for (const r of results) expect(r.statusCode).toBe(201);
    const ids = new Set(results.map((r) => r.json().id));
    expect(ids.size).toBe(1);
    const count = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales WHERE product_id=$1`, [id],
    );
    expect(count.rows[0]?.n).toBe('1');
  });
});
