import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Database } from './db/client.js';
import { getDb } from './db/client.js';
import { currentSchemaVersion } from './db/migrate.js';
import { registerErrorHandler } from './errors/mapper.js';
import { logger } from './logger.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { exportRoutes } from './routes/exports.js';
import { fiscalYearActionRoutes } from './routes/fiscalYear.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/imports.js';
import { lookupRoutes } from './routes/lookups.js';
import { periodRoutes } from './routes/periods.js';
import { productRoutes } from './routes/products.js';
import { reportRoutes } from './routes/reports.js';
import { settingsRoutes } from './routes/settings.js';
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

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 64 * 1024 * 1024 } });
  registerErrorHandler(app);

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(dashboardRoutes, { prefix: '/api' });
  await app.register(productRoutes, { prefix: '/api' });
  await app.register(lookupRoutes, { prefix: '/api' });
  await app.register(transactionRoutes, { prefix: '/api' });
  await app.register(periodRoutes, { prefix: '/api' });
  await app.register(fiscalYearActionRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(importRoutes, { prefix: '/api' });
  await app.register(exportRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });

  return app;
}
