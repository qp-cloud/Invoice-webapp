import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

describe('financial reports (spec §9.5, §21)', () => {
  let app: FastifyInstance;
  let db: Database;
  let a: string;
  let b: string;
  let c: string;

  const post = (url: string, payload: unknown): Promise<unknown> =>
    app.inject({ method: 'POST', url, payload, headers: { 'idempotency-key': randomUUID() } });
  const newProduct = async (sku: string, minStock = '0'): Promise<string> => {
    const r = await app.inject({
      method: 'POST', url: '/api/products',
      payload: { sku, name: sku, unitCode: 'piece', minStock },
    });
    return r.json().id as string;
  };

  beforeAll(async () => {
    db = await makeTestDb();
    app = await buildApp({ db });
    await app.ready();

    a = await newProduct('RP-A', '5');
    b = await newProduct('RP-B');

    // April: opening + a purchase + a sale for A
    await post('/api/openings', { productId: a, quantity: '40', unitCostSatang: 100000, occurredOn: '2026-03-31' });
    await post('/api/purchases', {
      productId: a, quantity: '60', unitCostSatang: 100000, occurredOn: '2026-04-05', backdateReason: 's',
    });
    await post('/api/sales', {
      productId: a, quantity: '30', unitPriceSatang: 150000, occurredOn: '2026-04-20', backdateReason: 's',
    });
    // A ends April with min-stock breach setup handled separately; leave B oversold
    await post('/api/openings', { productId: b, quantity: '2', unitCostSatang: 50000, occurredOn: '2026-03-31' });
    await post('/api/sales', {
      productId: b, quantity: '9', unitPriceSatang: 80000, occurredOn: '2026-04-11', backdateReason: 's',
    });

    c = await newProduct('RP-C', '10');
    await post('/api/openings', { productId: c, quantity: '4', unitCostSatang: 10000, occurredOn: '2026-03-31' });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('GET /api/reports/monthly aggregates opening / purchases / sales / COGS / closing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/monthly?ym=2026-04' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ym).toBe('2026-04');

    const rowA = body.rows.find((r: { sku: string }) => r.sku === 'RP-A');
    expect(rowA.openingQty).toBe('40');
    expect(rowA.purchasesQty).toBe('60');
    expect(rowA.purchasesValueSatang).toBe(6_000_000); // 60 * 100000
    expect(rowA.salesQty).toBe('30');
    expect(rowA.salesRevenueSatang).toBe(4_500_000); // 30 * 150000
    expect(rowA.estimatedCogsSatang).toBe(3_000_000); // avg 100000 * 30
    expect(rowA.estimatedGrossProfitSatang).toBe(1_500_000);
    expect(rowA.grossMarginPct).toBeCloseTo(33.33, 2);
    expect(rowA.closingQty).toBe('70'); // 40 + 60 - 30

    // totals cross-check against raw SQL
    const raw = await db.query<{ rev: string; cogs: string }>(
      `SELECT COALESCE(sum(total_price_satang),0)::text AS rev,
              COALESCE(sum(cogs_satang),0)::text AS cogs FROM sales
       WHERE status='ACTIVE' AND occurred_on >= '2026-04-01' AND occurred_on < '2026-05-01'`,
    );
    expect(body.totals.salesRevenueSatang).toBe(Number(raw.rows[0]!.rev));
    expect(body.totals.estimatedCogsSatang).toBe(Number(raw.rows[0]!.cogs));
  });

  it('monthly report gross margin guards divide-by-zero for a month with no sales', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/monthly?ym=2026-09' });
    const body = res.json();
    expect(body.totals.salesRevenueSatang).toBe(0);
    expect(body.totals.grossMarginPct).toBeNull();
  });

  it('GET /api/reports/low-stock lists products at or below min stock', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/low-stock' });
    const rows = res.json();
    const skus = rows.map((r: { sku: string }) => r.sku);
    expect(skus).toContain('RP-C'); // qty 4, min 10
    expect(skus).not.toContain('RP-A'); // qty 70, min 5
    expect(skus).not.toContain('RP-B'); // negative -> oversold, not low
    const rc = rows.find((r: { sku: string }) => r.sku === 'RP-C');
    expect(rc.shortfall).toBe('6');
  });

  it('GET /api/reports/oversold lists negative-stock products with missing balance', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/oversold' });
    const rows = res.json();
    const rb = rows.find((r: { sku: string }) => r.sku === 'RP-B');
    expect(rb.qtyOnHand).toBe('-7'); // 2 - 9
    expect(rb.missingBalance).toBe('7');
  });
});
