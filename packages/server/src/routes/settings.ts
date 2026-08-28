import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { updateSettings } from '../services/settings.js';

const patchBody = z.record(z.string(), z.unknown());

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', async () => {
    const { rows } = await app.db.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM settings ORDER BY key',
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  app.patch('/settings', async (req) => {
    const patch = patchBody.parse(req.body);
    return updateSettings(app.db, patch);
  });
}
