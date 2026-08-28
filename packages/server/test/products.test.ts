import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

describe('products & lookups', () => {
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

  const create = (body: unknown) =>
    app.inject({ method: 'POST', url: '/api/products', payload: body });

  it('creates a product, sanitizing the SKU, with a zeroed stock block', async () => {
    const res = await create({ sku: '  plas-001 ', name: 'สินค้า A', unitCode: 'piece', minStock: '500' });
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p.sku).toBe('PLAS-001');
    expect(p.stock.qtyOnHand).toBe('0');
    expect(p.stock.status).toBe('out'); // no stock yet
    expect(p.stock.oversold).toBe(false);
    expect(p.minStock).toBe('500');
  });

  it('rejects a duplicate SKU regardless of case/whitespace', async () => {
    const res = await create({ sku: 'plas-001', name: 'dup', unitCode: 'piece' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SKU_ALREADY_EXISTS');
  });

  it('rejects an unknown unit', async () => {
    const res = await create({ sku: 'X-1', name: 'x', unitCode: 'furlong' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a bad minStock via schema', async () => {
    const res = await create({ sku: 'X-2', name: 'x', unitCode: 'piece', minStock: 'abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('gets a product and 404s an unknown id', async () => {
    const created = (await create({ sku: 'G-1', name: 'g', unitCode: 'box' })).json();
    const ok = await app.inject({ method: 'GET', url: `/api/products/${created.id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().sku).toBe('G-1');

    const miss = await app.inject({
      method: 'GET',
      url: '/api/products/00000000-0000-0000-0000-000000000000',
    });
    expect(miss.statusCode).toBe(404);
    expect(miss.json().error.code).toBe('NOT_FOUND');
  });

  it('updates mutable fields and writes an audit entry', async () => {
    const created = (await create({ sku: 'U-1', name: 'old', unitCode: 'piece', minStock: '10' })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/products/${created.id}`,
      payload: { name: 'new', minStock: '25', active: false },
    });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.name).toBe('new');
    expect(p.minStock).toBe('25');
    expect(p.active).toBe(false);

    const audit = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE entity='product' AND entity_id=$1 AND action='UPDATE'`,
      [created.id],
    );
    expect(audit.rows[0]?.n).toBe('1');
  });

  it('rejects an empty update', async () => {
    const created = (await create({ sku: 'U-2', name: 'x', unitCode: 'piece' })).json();
    const res = await app.inject({ method: 'PATCH', url: `/api/products/${created.id}`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('lists with search, filters, sort and pagination', async () => {
    // seed a handful
    for (const s of ['LIST-1', 'LIST-2', 'LIST-3']) {
      await create({ sku: s, name: `รายการ ${s}`, unitCode: 'piece' });
    }
    const bySku = await app.inject({ method: 'GET', url: '/api/products?q=LIST-2' });
    expect(bySku.json().rows).toHaveLength(1);
    expect(bySku.json().rows[0].sku).toBe('LIST-2');

    const byName = await app.inject({ method: 'GET', url: '/api/products?q=' + encodeURIComponent('รายการ') });
    expect(byName.json().rows.length).toBeGreaterThanOrEqual(3);

    const page = await app.inject({ method: 'GET', url: '/api/products?pageSize=2&page=1&sort=sku&dir=asc' });
    const body = page.json();
    expect(body.rows).toHaveLength(2);
    expect(body.pageSize).toBe(2);
    expect(body.totalPages).toBeGreaterThanOrEqual(2);

    // everything is "out" (no stock) → oversoldOnly is empty, status=out is not
    const oversold = await app.inject({ method: 'GET', url: '/api/products?oversoldOnly=true' });
    expect(oversold.json().rows).toHaveLength(0);
    const out = await app.inject({ method: 'GET', url: '/api/products?status=out' });
    expect(out.json().rows.length).toBeGreaterThan(0);
  });

  it('categories: create, rename, block delete when in use', async () => {
    const cat = (
      await app.inject({ method: 'POST', url: '/api/categories', payload: { name: 'เครื่องเขียน' } })
    ).json();
    expect(cat.name).toBe('เครื่องเขียน');

    const dup = await app.inject({ method: 'POST', url: '/api/categories', payload: { name: 'เครื่องเขียน' } });
    expect(dup.statusCode).toBe(409);

    await create({ sku: 'CATP-1', name: 'p', unitCode: 'piece', categoryId: cat.id });
    const del = await app.inject({ method: 'DELETE', url: `/api/categories/${cat.id}` });
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('CATEGORY_IN_USE');
  });

  it('units: list seeded + create new', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/units' });
    expect(list.json().length).toBeGreaterThanOrEqual(10);
    const made = await app.inject({
      method: 'POST',
      url: '/api/units',
      payload: { code: 'carton', nameTh: 'ลัง' },
    });
    expect(made.statusCode).toBe(201);
  });

  it('upsert by SKU updates rather than duplicating', async () => {
    const { upsertProductBySku } = await import('../src/services/products.js');
    const first = await upsertProductBySku(db, {
      sku: ' up-1 ',
      name: 'first',
      unitCode: 'piece',
      minStock: '5',
    });
    expect(first.action).toBe('CREATE');
    const second = await upsertProductBySku(db, {
      sku: 'UP-1',
      name: 'second',
      unitCode: 'box',
      minStock: '9',
    });
    expect(second.action).toBe('UPDATE');
    expect(second.product.id).toBe(first.product.id);
    expect(second.product.name).toBe('second');
    expect(second.product.unitCode).toBe('box');

    const count = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM products WHERE sku = 'UP-1'`,
    );
    expect(count.rows[0]?.n).toBe('1');
  });
});
