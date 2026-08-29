import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

const TODAY = new Date().toISOString().slice(0, 10);

describe('financial: weighted-average, void-purchase replay, cost-basis reset (spec §9.2)', () => {
  let app: FastifyInstance;
  let db: Database;

  const post = (url: string, payload: unknown): Promise<unknown> =>
    app.inject({ method: 'POST', url, payload, headers: { 'idempotency-key': randomUUID() } });
  const newProduct = async (sku: string): Promise<string> => {
    const r = await app.inject({
      method: 'POST', url: '/api/products',
      payload: { sku, name: sku, unitCode: 'piece' },
    });
    return r.json().id as string;
  };
  const state = (id: string) =>
    db.query<{ qty: string; total: string; avg: string }>(
      `SELECT qty_on_hand::text AS qty, total_cost_satang::text AS total, avg_cost_micro::text AS avg
       FROM stock_state WHERE product_id = $1`,
      [id],
    );

  beforeAll(async () => {
    db = await makeTestDb();
    app = await buildApp({ db });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('voiding a purchase replays the ledger and restores the pre-purchase cost basis', async () => {
    const id = await newProduct('FIN-VP');
    await post('/api/openings', { productId: id, quantity: '100', unitCostSatang: 100000, occurredOn: TODAY });
    const purchase = await post('/api/purchases', {
      productId: id, quantity: '50', unitCostSatang: 200000, occurredOn: TODAY,
    });
    await post('/api/sales', { productId: id, quantity: '30', unitPriceSatang: 300000, occurredOn: TODAY });

    // avg after opening+purchase = (100*100000 + 50*200000) / 150 = 133333.33 satang/unit
    let s = (await state(id)).rows[0]!;
    expect(Number(s.qty)).toBe(120);

    const v = await post(`/api/documents/${(purchase as { json: () => { id: string } }).json().id}/void`, {
      kind: 'purchase', reason: 'กรอกผิด',
    });
    expect((v as { statusCode: number }).statusCode).toBe(200);

    // replay of ACTIVE = opening 100@100000, sale 30 -> qty 70, avg back to 100000, total 7,000,000
    s = (await state(id)).rows[0]!;
    expect(Number(s.qty)).toBe(70);
    expect(Number(s.avg)).toBe(100000 * 10_000); // micro
    expect(Number(s.total)).toBe(7_000_000);
  });

  it('a costed inflow while qty < 0 resets the cost basis and writes a COST_BASIS_RESET audit', async () => {
    const id = await newProduct('FIN-RESET');
    await post('/api/openings', { productId: id, quantity: '10', unitCostSatang: 100000, occurredOn: TODAY });
    await post('/api/sales', { productId: id, quantity: '30', unitPriceSatang: 120000, occurredOn: TODAY });

    let s = (await state(id)).rows[0]!;
    expect(Number(s.qty)).toBe(-20);

    await post('/api/adjustments', {
      productId: id, quantityDelta: '50', reasonCode: 'FOUND_EXTRA', unitCostSatang: 300000, occurredOn: TODAY,
    });

    s = (await state(id)).rows[0]!;
    expect(Number(s.qty)).toBe(30);
    expect(Number(s.avg)).toBe(300000 * 10_000); // reset to the inflow unit cost, micro

    const audit = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE action='COST_BASIS_RESET' AND entity_id=$1`,
      [id],
    );
    expect(audit.rows[0]!.n).toBe('1');
  });
});
