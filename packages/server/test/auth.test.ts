import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetConfigCache } from '../src/config.js';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers/testDb.js';

describe('owner unlock gate (spec §16.5)', () => {
  let db: Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = await makeTestDb();
  });
  afterEach(async () => {
    if (app) await app.close();
    await db.close();
    delete process.env.APP_PIN;
    resetConfigCache();
  });
  afterAll(() => {
    delete process.env.APP_PIN;
    resetConfigCache();
  });

  it('is open when no PIN is configured', async () => {
    resetConfigCache();
    app = await buildApp({ db });
    const r = await app.inject({ method: 'GET', url: '/api/products' });
    expect(r.statusCode).toBe(200);
    const s = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(s.json()).toMatchObject({ authRequired: false, unlocked: true });
  });

  it('with APP_PIN set: blocks API until unlocked, health stays open', async () => {
    process.env.APP_PIN = '4729';
    resetConfigCache();
    app = await buildApp({ db });

    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);

    const blocked = await app.inject({ method: 'GET', url: '/api/products' });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe('UNAUTHENTICATED');

    const bad = await app.inject({ method: 'POST', url: '/api/auth/unlock', payload: { pin: '0000' } });
    expect(bad.statusCode).toBe(401);

    const ok = await app.inject({ method: 'POST', url: '/api/auth/unlock', payload: { pin: '4729' } });
    expect(ok.statusCode).toBe(200);
    const cookie = ok.cookies.find((c) => c.name === 'inv_session')!;
    expect(cookie).toBeTruthy();

    const allowed = await app.inject({
      method: 'GET', url: '/api/products',
      cookies: { inv_session: cookie.value },
    });
    expect(allowed.statusCode).toBe(200);
  });
});
