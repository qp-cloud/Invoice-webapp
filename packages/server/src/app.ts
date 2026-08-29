import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { AppError } from '@inventory/shared';
import { loadConfig } from './config.js';
import type { Database } from './db/client.js';
import { getDb } from './db/client.js';
import { currentSchemaVersion } from './db/migrate.js';
import { registerErrorHandler } from './errors/mapper.js';
import { logger } from './logger.js';
import { authRequired, isUnlocked, SESSION_COOKIE } from './services/auth.js';
import { authRoutes } from './routes/auth.js';
import { backupRoutes } from './routes/backups.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { exportRoutes } from './routes/exports.js';
import { fiscalYearActionRoutes } from './routes/fiscalYear.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/imports.js';
import { lookupRoutes } from './routes/lookups.js';
import { periodRoutes } from './routes/periods.js';
import { productRoutes } from './routes/products.js';
import { reconcileRoutes } from './routes/reconcile.js';
import { reportRoutes } from './routes/reports.js';
import { settingsRoutes } from './routes/settings.js';
import { syncRoutes } from './routes/sync.js';
import { transactionRoutes } from './routes/transactions.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    schemaVersion: string | null;
  }
}

export interface BuildAppOptions {
  /** Inject a migrated database (tests). Defaults to the process singleton. */
  db?: Database;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    genReqId: () => randomUUID(),
    // pino instance; Fastify's bundled logger types are stricter than pino's export.
    loggerInstance: logger as unknown as FastifyBaseLogger,
  });

  app.decorate('db', opts.db ?? getDb());
  app.decorate('schemaVersion', await currentSchemaVersion(app.db));

  const distDir = loadConfig().WEB_DIST_DIR;
  const serveWeb = Boolean(distDir && existsSync(join(distDir, 'index.html')));

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 64 * 1024 * 1024 } });
  registerErrorHandler(app, { notFound: !serveWeb });

  // Owner unlock gate (spec §16.5). No-op unless a PIN is configured.
  const OPEN_PATHS = new Set(['/api/health', '/api/auth/status', '/api/auth/unlock', '/api/auth/set-pin']);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return; // SPA assets handled below
    const path = req.url.split('?')[0] ?? req.url;
    if (OPEN_PATHS.has(path)) return;
    if (!(await authRequired(app.db))) return;
    if (await isUnlocked(app.db, req.cookies[SESSION_COOKIE])) return;
    throw new AppError('UNAUTHENTICATED');
  });

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.register(productRoutes, { prefix: '/api' });
  await app.register(lookupRoutes, { prefix: '/api' });
  await app.register(transactionRoutes, { prefix: '/api' });
  await app.register(periodRoutes, { prefix: '/api' });
  await app.register(fiscalYearActionRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(reconcileRoutes, { prefix: '/api' });
  await app.register(importRoutes, { prefix: '/api' });
  await app.register(exportRoutes, { prefix: '/api' });
  await app.register(syncRoutes, { prefix: '/api' });
  await app.register(backupRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });

  // Serve the built web app + SPA fallback when WEB_DIST_DIR points at a real dist.
  if (serveWeb && distDir) {
    await app.register(fastifyStatic, { root: distDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'ไม่พบข้อมูล', correlationId: req.id },
        });
      }
      return reply.sendFile('index.html');
    });
    logger.info({ distDir }, 'serving web app');
  }

  return app;
}
