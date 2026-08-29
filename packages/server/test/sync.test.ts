import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

const TODAY = new Date().toISOString().slice(0, 10);

describe('offline sync batch (spec §12, API.md §13)', () => {
  let app: FastifyInstance;
  let db: Database;
  let productId: string;

  const newProduct = async (sku: string): Promise<string> => {
    const r = await app.inject({
      method: 'POST', url: '/api/products',
      payload: { sku, name: sku, unitCode: 'piece' },
    });
    return r.json().id as string;
  };
  const sync = (operations: unknown[]): Promise<{ statusCode: number; json: () => { results: Record<string, unknown>[] } }> =>
    app.inject({ method: 'POST', url: '/api/sync', payload: { operations } });
  const op = (endpoint: string, body: unknown, key = randomUUID()): Record<string, unknown> => ({
    localId: randomUUID(), idempotencyKey: key, endpoint, body,
  });

  beforeAll(async () => {
    db = await makeTestDb();
    app = await buildApp({ db });
    await app.ready();
    productId = await newProduct('SYNC-1');
    await app.inject({
      method: 'POST', url: '/api/openings',
      payload: { productId, quantity: '100', unitCostSatang: 10000, occurredOn: TODAY },
      headers: { 'idempotency-key': randomUUID() },
    });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('GET /api/sync/state reports server clock, fiscal year, open periods, mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sync/state' });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(typeof b.serverTime).toBe('string');
    expect(b.currentFiscalYear).toBe(2569);
    expect(Array.isArray(b.openPeriods)).toBe(true);
    expect(b.negativeStockMode).toBe('ALLOW');
  });

  it('processes a batch in FIFO order and returns a serverId per synced op', async () => {
    const res = await sync([
      op('/purchases', { productId, quantity: '50', unitCostSatang: 10000, occurredOn: TODAY }),
      op('/sales', { productId, quantity: '120', unitPriceSatang: 15000, occurredOn: TODAY }),
    ]);
    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results.map((r) => r.status)).toEqual(['SYNCED', 'SYNCED']);
    expect(results.every((r) => typeof r.serverId === 'string')).toBe(true);

    const stock = (await app.inject({ method: 'GET', url: `/api/products/${productId}/stock` })).json();
    expect(stock.qtyOnHand).toBe('30'); // 100 + 50 - 120
  });

  it('re-flushing the same operations replays, creating nothing new', async () => {
    const key = randomUUID();
    const body = { productId, quantity: '5', unitPriceSatang: 15000, occurredOn: TODAY };
    const first = await sync([op('/sales', body, key)]);
    const second = await sync([op('/sales', body, key)]);
    expect(first.json().results[0]!.status).toBe('SYNCED');
    expect(second.json().results[0]!.status).toBe('SYNCED');
    expect(second.json().results[0]!.replayed).toBe(true);
    expect(second.json().results[0]!.serverId).toBe(first.json().results[0]!.serverId);

    const n = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales WHERE product_id = $1 AND quantity = 5`, [productId],
    );
    expect(n.rows[0]!.n).toBe('1');
  });

  it('isolates a CONFLICT (closed period) and keeps processing the rest', async () => {
    await app.inject({ method: 'POST', url: '/api/periods/2026-02/close' });
    const res = await sync([
      op('/purchases', { productId, quantity: '3', unitCostSatang: 10000, occurredOn: '2026-02-15', backdateReason: 'x' }),
      op('/purchases', { productId, quantity: '4', unitCostSatang: 10000, occurredOn: TODAY }),
    ]);
    const { results } = res.json();
    expect(results[0]!.status).toBe('CONFLICT');
    expect(results[0]!.code).toBe('PERIOD_CLOSED');
    expect(results[1]!.status).toBe('SYNCED');
    await app.inject({ method: 'POST', url: '/api/periods/2026-02/reopen', payload: { reason: 't' } });
  });

  it('PREVENT oversell is a CONFLICT, later ops still sync', async () => {
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { negative_stock_mode: 'PREVENT' } });
    const p2 = await newProduct('SYNC-2');
    await app.inject({
      method: 'POST', url: '/api/openings',
      payload: { productId: p2, quantity: '10', unitCostSatang: 10000, occurredOn: TODAY },
      headers: { 'idempotency-key': randomUUID() },
    });
    const res = await sync([
      op('/sales', { productId: p2, quantity: '999', unitPriceSatang: 15000, occurredOn: TODAY }),
      op('/adjustments', { productId: p2, quantityDelta: '5', reasonCode: 'FOUND_EXTRA', unitCostSatang: 10000, occurredOn: TODAY }),
    ]);
    const { results } = res.json();
    expect(results[0]!.status).toBe('CONFLICT');
    expect(results[0]!.code).toBe('STOCK_WOULD_GO_NEGATIVE');
    expect(results[1]!.status).toBe('SYNCED');
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { negative_stock_mode: 'ALLOW' } });
  });
});
