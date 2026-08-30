import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = TODAY.slice(0, 4);
const YM = TODAY.slice(0, 7);

describe('tax invoices + VAT reports (module 0004)', () => {
  let app: FastifyInstance;
  let db: Database;
  let supplierId: string;
  let customerId: string;
  let pA: string;
  let pB: string;

  const post = (url: string, payload: unknown, key?: string) =>
    app.inject({
      method: 'POST', url, payload,
      headers: key ? { 'idempotency-key': key } : {},
    });

  beforeAll(async () => {
    db = await makeTestDb();
    app = await buildApp({ db });
    await app.ready();

    const mkProduct = async (sku: string): Promise<string> =>
      (await app.inject({ method: 'POST', url: '/api/products', payload: { sku, name: sku, unitCode: 'piece' } })).json().id;
    pA = await mkProduct('INV-A');
    pB = await mkProduct('INV-B');
    // seed stock so SELL invoices have something to draw down
    await post('/api/openings', { productId: pA, quantity: '1000', unitCostSatang: 8000, occurredOn: TODAY }, randomUUID());
    await post('/api/openings', { productId: pB, quantity: '1000', unitCostSatang: 9000, occurredOn: TODAY }, randomUUID());

    supplierId = (await post('/api/contacts', {
      kind: 'SUPPLIER', name: 'ผู้ขายกรุงเทพ', taxId: '0105512345678', branch: 'สำนักงานใหญ่',
    })).json().id;
    customerId = (await post('/api/contacts', {
      kind: 'CUSTOMER', name: 'อู่ลาว เวียงจันทน์',
    })).json().id;
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('BUY invoice: draft computes VAT, confirm assigns a gapless number and raises stock', async () => {
    const draft = await post('/api/invoices', {
      docType: 'BUY', contactId: supplierId, issueDate: TODAY,
      lines: [
        { productId: pA, quantity: '10', unitPriceSatang: 10000, vatRate: 7 },
        { productId: pB, quantity: '5', unitPriceSatang: 20000, vatRate: 7 },
      ],
    });
    expect(draft.statusCode).toBe(201);
    const inv = draft.json();
    expect(inv.status).toBe('DRAFT');
    expect(inv.invoiceNumber).toBeNull();
    expect(inv.subtotalSatang).toBe(200000); // 10*10000 + 5*20000
    expect(inv.vatSatang).toBe(14000); // 7%
    expect(inv.totalSatang).toBe(214000);

    const c = await post(`/api/invoices/${inv.id}/confirm`, {}, randomUUID());
    expect(c.statusCode).toBe(200);
    expect(c.json().invoiceNumber).toBe(`BUY-${YEAR}-0001`);
    expect(c.json().status).toBe('CONFIRMED');

    const stockA = (await app.inject({ method: 'GET', url: `/api/products/${pA}/stock` })).json();
    expect(stockA.qtyOnHand).toBe('1010'); // 1000 + 10
  });

  it('confirm is idempotent (same key replays, no double stock)', async () => {
    const draft = await post('/api/invoices', {
      docType: 'BUY', contactId: supplierId, issueDate: TODAY,
      lines: [{ productId: pA, quantity: '3', unitPriceSatang: 10000, vatRate: 7 }],
    });
    const key = randomUUID();
    const first = await post(`/api/invoices/${draft.json().id}/confirm`, {}, key);
    const again = await post(`/api/invoices/${draft.json().id}/confirm`, {}, key);
    expect(first.json().invoiceNumber).toBe(`BUY-${YEAR}-0002`);
    expect(again.json()._replayed).toBe(true);
    expect(again.json().invoiceNumber).toBe(`BUY-${YEAR}-0002`);
    const stockA = (await app.inject({ method: 'GET', url: `/api/products/${pA}/stock` })).json();
    expect(stockA.qtyOnHand).toBe('1013'); // 1010 + 3, once
  });

  it('SELL invoice: lowers stock, books COGS, zero-rated line carries no VAT', async () => {
    const draft = await post('/api/invoices', {
      docType: 'SELL', contactId: customerId, issueDate: TODAY,
      lines: [
        { productId: pA, quantity: '4', unitPriceSatang: 15000, vatRate: 7 },
        { productId: pB, quantity: '2', unitPriceSatang: 30000, vatRate: 0 }, // export to Laos, zero-rated
      ],
    });
    const inv = draft.json();
    expect(inv.subtotalSatang).toBe(120000); // 4*15000 + 2*30000
    expect(inv.vatSatang).toBe(4200); // 7% of 60000 only
    expect(inv.totalSatang).toBe(124200);

    const c = await post(`/api/invoices/${inv.id}/confirm`, {}, randomUUID());
    expect(c.json().invoiceNumber).toBe(`SELL-${YEAR}-0001`);
    expect(c.json().totalCogsSatang).toBeGreaterThan(0);

    const stockA = (await app.inject({ method: 'GET', url: `/api/products/${pA}/stock` })).json();
    expect(stockA.qtyOnHand).toBe('1009'); // 1013 - 4
  });

  it('void a confirmed invoice: reverses stock, keeps the number', async () => {
    const draft = await post('/api/invoices', {
      docType: 'BUY', contactId: supplierId, issueDate: TODAY,
      lines: [{ productId: pB, quantity: '7', unitPriceSatang: 10000, vatRate: 7 }],
    });
    const id = draft.json().id;
    await post(`/api/invoices/${id}/confirm`, {}, randomUUID());
    const beforeVoid = (await app.inject({ method: 'GET', url: `/api/products/${pB}/stock` })).json().qtyOnHand;

    const v = await post(`/api/invoices/${id}/void`, { reason: 'กรอกผิด' }, randomUUID());
    expect(v.statusCode).toBe(200);
    expect(v.json().status).toBe('VOID');

    const detail = (await app.inject({ method: 'GET', url: `/api/invoices/${id}` })).json();
    expect(detail.invoice.status).toBe('VOID');
    expect(detail.invoice.invoiceNumber).toMatch(/^BUY-/); // number retained

    const afterVoid = (await app.inject({ method: 'GET', url: `/api/products/${pB}/stock` })).json().qtyOnHand;
    expect(Number(beforeVoid) - Number(afterVoid)).toBe(7);
  });

  it('a CONFIRMED invoice cannot be edited', async () => {
    const draft = await post('/api/invoices', {
      docType: 'BUY', contactId: supplierId, issueDate: TODAY,
      lines: [{ productId: pA, quantity: '1', unitPriceSatang: 10000, vatRate: 7 }],
    });
    await post(`/api/invoices/${draft.json().id}/confirm`, {}, randomUUID());
    const edit = await app.inject({
      method: 'PATCH', url: `/api/invoices/${draft.json().id}`, payload: { note: 'x' },
    });
    expect(edit.statusCode).toBe(409);
  });

  it('รายงานภาษีซื้อ lists confirmed BUY invoices with supplier tax id + VAT', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/vat-reports/purchase?ym=${YM}` });
    expect(res.statusCode).toBe(200);
    const rep = res.json();
    expect(rep.kind).toBe('purchase');
    expect(rep.rows.length).toBeGreaterThanOrEqual(2);
    const first = rep.rows.find((r: { invoiceNumber: string }) => r.invoiceNumber === `BUY-${YEAR}-0001`);
    expect(first.contactTaxId).toBe('0105512345678');
    expect(first.netSatang).toBe(200000);
    expect(first.vatSatang).toBe(14000);
    // void invoice excluded from totals
    expect(rep.totals.count).toBe(rep.rows.length);
    // cross-check vs raw SQL
    const raw = await db.query<{ net: string; vat: string }>(
      `SELECT coalesce(sum(subtotal_satang),0)::text net, coalesce(sum(vat_satang),0)::text vat
       FROM invoices WHERE doc_type='BUY' AND status='CONFIRMED' AND to_char(issue_date,'YYYY-MM')=$1`,
      [YM],
    );
    expect(rep.totals.netSatang).toBe(Number(raw.rows[0]!.net));
    expect(rep.totals.vatSatang).toBe(Number(raw.rows[0]!.vat));
  });

  it('รายงานภาษีขาย + CSV export', async () => {
    const rep = (await app.inject({ method: 'GET', url: `/api/vat-reports/sales?ym=${YM}` })).json();
    expect(rep.rows.some((r: { invoiceNumber: string }) => r.invoiceNumber === `SELL-${YEAR}-0001`)).toBe(true);

    const xlsx = await app.inject({ method: 'GET', url: `/api/exports/vat-sales.xlsx?ym=${YM}` });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('numbering stays gapless when a confirm fails (PREVENT oversell)', async () => {
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { negative_stock_mode: 'PREVENT' } });
    const bad = await post('/api/invoices', {
      docType: 'SELL', contactId: customerId, issueDate: TODAY,
      lines: [{ productId: pA, quantity: '99999', unitPriceSatang: 10000, vatRate: 7 }],
    });
    const fail = await post(`/api/invoices/${bad.json().id}/confirm`, {}, randomUUID());
    expect(fail.statusCode).toBe(422);

    const ok = await post('/api/invoices', {
      docType: 'SELL', contactId: customerId, issueDate: TODAY,
      lines: [{ productId: pA, quantity: '1', unitPriceSatang: 10000, vatRate: 7 }],
    });
    const good = await post(`/api/invoices/${ok.json().id}/confirm`, {}, randomUUID());
    expect(good.json().invoiceNumber).toBe(`SELL-${YEAR}-0002`); // 0002, not 0003 — no number burned
    await app.inject({ method: 'PATCH', url: '/api/settings', payload: { negative_stock_mode: 'ALLOW' } });
  });
});
