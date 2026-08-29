import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

const TODAY = new Date().toISOString().slice(0, 10);

describe('dashboard + master table 68/69 view (spec §18.1, §19.1)', () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(async () => {
    db = await makeTestDb();
    app = await buildApp({ db });
    await app.ready();

    const newProduct = async (sku: string, minStock = '0'): Promise<string> => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/products',
        payload: { sku, name: sku, unitCode: 'piece', minStock },
      });
      return r.json().id as string;
    };
    const post = (url: string, payload: unknown): Promise<unknown> =>
      app.inject({ method: 'POST', url, payload, headers: { 'idempotency-key': randomUUID() } });

    const a = await newProduct('DASH-A');
    await post('/api/openings', { productId: a, quantity: '100', unitCostSatang: 100000, occurredOn: TODAY });
    await post('/api/purchases', { productId: a, quantity: '50', unitCostSatang: 120000, occurredOn: TODAY });
    await post('/api/sales', { productId: a, quantity: '30', unitPriceSatang: 200000, occurredOn: TODAY });

    const b = await newProduct('DASH-B');
    await post('/api/openings', { productId: b, quantity: '10', unitCostSatang: 50000, occurredOn: TODAY });
    await post('/api/sales', { productId: b, quantity: '15', unitPriceSatang: 90000, occurredOn: TODAY });

    const c = await newProduct('DASH-C', '5');
    await post('/api/openings', { productId: c, quantity: '3', unitCostSatang: 10000, occurredOn: TODAY });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('GET /api/dashboard returns SQL-aggregated KPI figures', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(res.statusCode).toBe(200);
    const d = res.json();

    expect(d.fiscalYear).toBe(2569);
    expect(d.stock68Qty).toBe('113'); // 100 + 10 + 3
    expect(d.purchasesCfyQty).toBe('50');
    expect(d.purchasesCfyValueSatang).toBe(6_000_000); // 50 * 120000
    expect(d.salesCfyQty).toBe('45'); // 30 + 15
    expect(d.salesRevenueSatang).toBe(7_350_000); // 30*200000 + 15*90000
    expect(d.currentStockQty).toBe('118'); // A 120 + B -5 + C 3
    expect(d.oversoldSkuCount).toBe(1); // B
    expect(d.lowStockSkuCount).toBe(1); // C (qty 3, min 5)
    expect(d.estimatedGrossProfitSatang).toBe(d.salesRevenueSatang - d.estimatedCogsSatang);
    expect(typeof d.asOf).toBe('string');
  });

  it('dashboard money figures cross-check against raw SQL', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const d = res.json();

    const purch = await db.query<{ v: string }>(
      `SELECT COALESCE(sum(total_cost_satang),0)::text AS v FROM purchases
       WHERE status='ACTIVE' AND extract(year FROM occurred_on) = 2026`,
    );
    const sale = await db.query<{ rev: string; cogs: string }>(
      `SELECT COALESCE(sum(total_price_satang),0)::text AS rev,
              COALESCE(sum(cogs_satang),0)::text        AS cogs FROM sales
       WHERE status='ACTIVE' AND extract(year FROM occurred_on) = 2026`,
    );
    expect(d.purchasesCfyValueSatang).toBe(Number(purch.rows[0]!.v));
    expect(d.salesRevenueSatang).toBe(Number(sale.rows[0]!.rev));
    expect(d.estimatedCogsSatang).toBe(Number(sale.rows[0]!.cogs));
  });

  it('GET /api/products carries per-row fyView and dynamic labels', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/products?sort=sku&pageSize=50' });
    const body = res.json();
    expect(body.fiscalYear).toBe(2569);
    expect(body.labels).toEqual({
      stock68: 'Stock 69',
      purchases: 'ซื้อเข้า 69',
      sales: 'ขายออก 69',
    });

    const rowA = body.rows.find((r: { sku: string }) => r.sku === 'DASH-A');
    expect(rowA.fyView).toEqual({
      stock68: '100',
      purchasesCfy: '50',
      salesCfy: '30',
      variance: '20',
    });
    expect(rowA.stock.qtyOnHand).toBe('120');

    const rowB = body.rows.find((r: { sku: string }) => r.sku === 'DASH-B');
    expect(rowB.fyView.variance).toBe('-15'); // 0 purchases - 15 sales
    expect(rowB.stock.oversold).toBe(true);
    expect(rowB.stock.missingBalance).toBe('5');
  });

  it('oversold-only and low-stock-only filters match the mock dataset', async () => {
    const oversold = (
      await app.inject({ method: 'GET', url: '/api/products?oversoldOnly=true' })
    ).json();
    expect(oversold.rows.map((r: { sku: string }) => r.sku)).toEqual(['DASH-B']);

    const low = (
      await app.inject({ method: 'GET', url: '/api/products?lowStockOnly=true' })
    ).json();
    expect(low.rows.map((r: { sku: string }) => r.sku)).toEqual(['DASH-C']);
  });
});
