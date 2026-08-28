import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Database } from './db/client.js';
import { getDb } from './db/client.js';
import { currentSchemaVersion } from './db/migrate.js';
import { registerErrorHandler } from './errors/mapper.js';
import { logger } from './logger.js';
import { healthRoutes } from './routes/health.js';

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
  registerErrorHandler(app);

  await app.register(healthRoutes, { prefix: '/api' });

  return app;
}
