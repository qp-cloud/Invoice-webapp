import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

describe('fiscal-year rollover (spec §6.5)', () => {
  let app: FastifyInstance;
  let db: Database;
  let productId: string;

  beforeAll(async () => {
    db = await makeTestDb();
    app = await buildApp({ db });
    await app.ready();

    const p = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { sku: 'FY-1', name: 'FY-1', unitCode: 'piece' },
    });
    productId = p.json().id as string;
    const post = (url: string, payload: unknown): Promise<unknown> =>
      app.inject({ method: 'POST', url, payload, headers: { 'idempotency-key': randomUUID() } });
    await post('/api/openings', { productId, quantity: '100', unitCostSatang: 100000, occurredOn: '2026-06-01' });
    await post('/api/purchases', {
      productId, quantity: '20', unitCostSatang: 100000, occurredOn: '2026-07-10', backdateReason: 'seed',
    });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('rejects the roll while periods of the outgoing year are still open', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fiscal-year/roll',
      payload: { confirm: true, backupConfirmed: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('FY_PERIODS_OPEN');
  });

  it('requires a backup before rolling', async () => {
    for (let m = 1; m <= 12; m += 1) {
      const ym = `2026-${String(m).padStart(2, '0')}`;
      const c = await app.inject({ method: 'POST', url: `/api/periods/${ym}/close` });
      expect(c.statusCode).toBe(200);
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/fiscal-year/roll',
      payload: { confirm: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BACKUP_REQUIRED');
  });

  it('advances the fiscal year, opens the new periods, moves no ledger data', async () => {
    const movBefore = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM movements');

    const res = await app.inject({
      method: 'POST',
      url: '/api/fiscal-year/roll',
      payload: { confirm: true, backupConfirmed: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ previousFiscalYear: 2569, currentFiscalYear: 2570 });
    expect(res.json().periodsOpenedForNewYear).toHaveLength(12);

    const movAfter = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM movements');
    expect(movAfter.rows[0]!.n).toBe(movBefore.rows[0]!.n);

    const fy = (await app.inject({ method: 'GET', url: '/api/fiscal-year' })).json();
    expect(fy.currentFiscalYear).toBe(2570);
    expect(fy.labels.stock).toBe('Stock 70');

    const audit = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE action='ROLL_FISCAL_YEAR'`,
    );
    expect(audit.rows[0]!.n).toBe('1');
  });

  it('after the roll, Stock 68 is the prior year closing balance (derived, no snapshot)', async () => {
    const stock = (
      await app.inject({ method: 'GET', url: `/api/products/${productId}/stock` })
    ).json();
    // closing 2026 = opening 100 + purchase 20 = 120; nothing dated in FY2570 (greg 2027)
    expect(stock.fyView.stock68).toBe('120');
    expect(stock.fyView.purchasesCfy).toBe('0');
    expect(stock.fyView.salesCfy).toBe('0');

    const dash = (await app.inject({ method: 'GET', url: '/api/dashboard' })).json();
    expect(dash.fiscalYear).toBe(2570);
    expect(dash.stock68Qty).toBe('120');
    expect(dash.purchasesCfyQty).toBe('0');

    const list = (await app.inject({ method: 'GET', url: '/api/products?sort=sku' })).json();
    expect(list.labels.stock68).toBe('Stock 70');
    expect(list.rows.find((r: { sku: string }) => r.sku === 'FY-1').fyView.stock68).toBe('120');
  });
});
