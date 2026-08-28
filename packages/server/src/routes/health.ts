import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { version as appVersion } from '../version.js';

export async function healthRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get('/health', async () => {
    let db: 'up' | 'down' = 'down';
    let pgVersion = 'unknown';
    try {
      const res = await app.db.query<{ version: string }>('SELECT version() AS version');
      db = 'up';
      pgVersion = res.rows[0]?.version ?? 'unknown';
    } catch {
      db = 'down';
    }
    return {
      ok: db === 'up',
      db,
      schemaVersion: app.schemaVersion,
      appVersion,
      pgVersion,
    };
  });
}
