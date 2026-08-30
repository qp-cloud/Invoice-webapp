import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

describe('company profiles', () => {
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

  it('migrates the legacy company and creates another profile', async () => {
    const initial = await app.inject({ method: 'GET', url: '/api/company-profiles' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toHaveLength(1);
    expect(initial.json()[0].code).toBe('MAIN');

    const created = await app.inject({
      method: 'POST',
      url: '/api/company-profiles',
      payload: {
        code: 'SHOP2', name: 'บริษัทสาขาสอง', nameEn: '', taxId: '',
        branch: '00002', address: 'หนองคาย', phone: '042000000',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ code: 'SHOP2', name: 'บริษัทสาขาสอง', active: true });

    const listed = await app.inject({ method: 'GET', url: '/api/company-profiles' });
    expect(listed.json()).toHaveLength(2);
  });

  it('does not allow disabling the final active company', async () => {
    const profiles = (await app.inject({ method: 'GET', url: '/api/company-profiles' })).json();
    const disabled = await app.inject({ method: 'PATCH', url: `/api/company-profiles/${profiles[1].id}`, payload: { active: false } });
    expect(disabled.statusCode, disabled.body).toBe(200);
    const last = await app.inject({ method: 'PATCH', url: `/api/company-profiles/${profiles[0].id}`, payload: { active: false } });
    expect(last.statusCode).toBe(400);
  });
});
