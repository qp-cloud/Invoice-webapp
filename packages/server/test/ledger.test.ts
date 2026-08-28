import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

const TODAY = new Date().toISOString().slice(0, 10);

describe('inventory ledger', () => {
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

  const newProduct = async (sku: string, minStock = '0'): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { sku, name: sku, unitCode: 'piece', minStock },
    });
    return res.json().id as string;
  };

  const post = (url: string, payload: unknown, key = randomUUID()) =>
    app.inject({ method: 'POST', url, payload, headers: { 'idempotency-key': key } });

  it('worked example §5.5: opening 1000 + purchase 8000 - sale 7700 = 1300', async () => {
    const id = await newProduct('WE-1', '500');
    await post('/api/openings', { productId: id, quantity: '1000', unitCostSatang: 10000, occurredOn: TODAY });
    await post('/api/purchases', { productId: id, quantity: '8000', unitCostSatang: 10000, occurredOn: TODAY });
    const sale = await post('/api/sales', { productId: id, quantity: '7700', unitPriceSatang: 15000, occurredOn: TODAY });
    expect(sale.statusCode).toBe(201);

    const stock = await app.inject({ method: 'GET', url: `/api/products/${id}/stock` });
    const b = stock.json();
    expect(b.qtyOnHand).toBe('1300');
    expect(b.status).toBe('normal');
    expect(b.fyView.stock68).toBe('1000');
    expect(b.fyView.purchasesCfy).toBe('8000');
    expect(b.fyView.salesCfy).toBe('7700');
    expect(b.fyView.variance).toBe('300');
  });

  it('§11 ledger view with running balance, void excluded', async () => {
    const id = await newProduct('LG-1');
    await post('/api/openings', { productId: id, quantity: '1000', unitCostSatang: 10000, occurredOn: TODAY });
    await post('/api/purchases', { productId: id, quantity: '500', unitCostSatang: 10000, occurredOn: TODAY });
    const sale = await post('/api/sales', { productId: id, quantity: '120', unitPriceSatang: 15000, occurredOn: TODAY });
    await post('/api/adjustments', { productId: id, quantityDelta: '-10', reasonCode: 'DAMAGED', occurredOn: TODAY });
    await post('/api/returns', { productId: id, kind: 'CUSTOMER', quantity: '20', unitCostSatang: 10000, occurredOn: TODAY });

    let led = await app.inject({ method: 'GET', url: `/api/products/${id}/ledger` });
    let rows = led.json().rows;
    expect(rows.at(-1).runningBalance).toBe('1390');
    expect(led.json().currentStock).toBe('1390');

    // void the sale -> stock returns to 1510, sale movement excluded
    const v = await post(`/api/documents/${sale.json().id}/void`, { kind: 'sale', reason: 'กรอกผิด' });
    expect(v.statusCode).toBe(200);

    const stock = await app.inject({ method: 'GET', url: `/api/products/${id}/stock` });
    expect(stock.json().qtyOnHand).toBe('1510');

    led = await app.inject({ method: 'GET', url: `/api/products/${id}/ledger` });
    rows = led.json().rows;
    const voided = rows.find((r: { type: string }) => r.type === 'SALE');
    expect(voided.status).toBe('VOIDED');
    expect(rows.at(-1).runningBalance).toBe('1510');

    const audit = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE action='VOID' AND entity_id=$1`,
      [sale.json().id],
    );
    expect(audit.rows[0]?.n).toBe('1');
  });

  it('mock dataset §23 golden: qty, status, variance', async () => {
    const cases = [
      { sku: 'MD-1', o: '1000', p: '8000', s: '7700', min: '500', qty: '1300', status: 'normal', variance: '300' },
      { sku: 'MD-2', o: '500', p: '5000', s: '5350', min: '300', qty: '150', status: 'low', variance: '-350' },
      { sku: 'MD-3', o: '200', p: '300', s: '500', min: '50', qty: '0', status: 'out', variance: '-200' },
      { sku: 'MD-4', o: '50', p: '0', s: '70', min: '20', qty: '-20', status: 'out', variance: '-70' },
    ];
    for (const c of cases) {
      const id = await newProduct(c.sku, c.min);
      await post('/api/openings', { productId: id, quantity: c.o, unitCostSatang: 10000, occurredOn: TODAY });
      if (c.p !== '0') {
        await post('/api/purchases', { productId: id, quantity: c.p, unitCostSatang: 10000, occurredOn: TODAY });
      }
      if (c.s !== '0') {
        await post('/api/sales', { productId: id, quantity: c.s, unitPriceSatang: 12000, occurredOn: TODAY });
      }
      const stock = (await app.inject({ method: 'GET', url: `/api/products/${id}/stock` })).json();
      expect(stock.qtyOnHand).toBe(c.qty);
      expect(stock.status).toBe(c.status);
      expect(stock.fyView.variance).toBe(c.variance);
      if (c.qty.startsWith('-')) {
        expect(stock.oversold).toBe(true);
        expect(stock.missingBalance).toBe(c.qty.slice(1));
      }
    }
  });

  it('ALLOW mode: sale beyond stock succeeds and flags oversold', async () => {
    const id = await newProduct('OS-1');
    await post('/api/openings', { productId: id, quantity: '10', unitCostSatang: 10000, occurredOn: TODAY });
    const sale = await post('/api/sales', { productId: id, quantity: '30', unitPriceSatang: 12000, occurredOn: TODAY });
    expect(sale.statusCode).toBe(201);
    expect(sale.json().oversold).toBe(true);
    expect(sale.json().missingBalance).toBe('20');
  });

  it('PREVENT mode: sale beyond stock is rejected and nothing is written', async () => {
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { negative_stock_mode: 'PREVENT' } });
    const id = await newProduct('PV-1');
    await post('/api/openings', { productId: id, quantity: '10', unitCostSatang: 10000, occurredOn: TODAY });
    const before = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM movements WHERE product_id=$1`, [id],
    );
    const sale = await post('/api/sales', { productId: id, quantity: '30', unitPriceSatang: 12000, occurredOn: TODAY });
    expect(sale.statusCode).toBe(422);
    expect(sale.json().error.code).toBe('STOCK_WOULD_GO_NEGATIVE');
    expect(sale.json().error.details.shortfall).toBe('20');
    const after = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM movements WHERE product_id=$1`, [id],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const saleCount = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales WHERE product_id=$1`, [id],
    );
    expect(saleCount.rows[0]?.n).toBe('0');
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { negative_stock_mode: 'ALLOW' } });
  });

  it('closed period rejects writes into it', async () => {
    const id = await newProduct('CP-1');
    const close = await app.inject({ method: 'POST', url: '/api/periods/2026-03/close' });
    expect(close.statusCode).toBe(200);
    const p = await post('/api/purchases', { productId: id, quantity: '5', unitCostSatang: 10000, occurredOn: '2026-03-15', backdateReason: 'x' });
    expect(p.statusCode).toBe(409);
    expect(p.json().error.code).toBe('PERIOD_CLOSED');
    await app.inject({ method: 'POST', url: '/api/periods/2026-03/reopen', payload: { reason: 'test' } });
  });

  it('backdated transaction: reason required past threshold, then audited', async () => {
    const id = await newProduct('BD-1');
    const noReason = await post('/api/purchases', { productId: id, quantity: '5', unitCostSatang: 10000, occurredOn: '2026-01-05' });
    expect(noReason.statusCode).toBe(400);

    const withReason = await post('/api/purchases', {
      productId: id, quantity: '5', unitCostSatang: 10000, occurredOn: '2026-01-05', backdateReason: 'ลืมบันทึก',
    });
    expect(withReason.statusCode).toBe(201);
    expect(withReason.json().warnings).toContain('BACKDATED');
    const audit = await db.query<{ reason: string }>(
      `SELECT reason FROM audit_log WHERE entity='purchase' AND entity_id=$1`,
      [withReason.json().id],
    );
    expect(audit.rows[0]?.reason).toBe('ลืมบันทึก');
  });

  it('idempotency: same key -> one movement + replayed; different body -> 422', async () => {
    const id = await newProduct('ID-1');
    await post('/api/openings', { productId: id, quantity: '100', unitCostSatang: 10000, occurredOn: TODAY });
    const key = randomUUID();
    const body = { productId: id, quantity: '10', unitPriceSatang: 12000, occurredOn: TODAY };
    const first = await post('/api/sales', body, key);
    const second = await post('/api/sales', body, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()._replayed).toBe(true);
    expect(second.json().id).toBe(first.json().id);
    const count = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales WHERE product_id=$1`, [id],
    );
    expect(count.rows[0]?.n).toBe('1');

    const different = await post('/api/sales', { ...body, quantity: '11' }, key);
    expect(different.statusCode).toBe(422);
    expect(different.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY');
  });

  it('fiscal-year labels reflect current_fiscal_year', async () => {
    const fy = await app.inject({ method: 'GET', url: '/api/fiscal-year' });
    expect(fy.json().currentFiscalYear).toBe(2569);
    expect(fy.json().labels.stock).toBe('Stock 69');
    expect(fy.json().labels.purchases).toBe('ซื้อเข้า 69');
  });

  it('missing Idempotency-Key is rejected', async () => {
    const id = await newProduct('NK-1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/purchases',
      payload: { productId: id, quantity: '1', unitCostSatang: 100, occurredOn: TODAY },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});
