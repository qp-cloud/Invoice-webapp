import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getSyncState, runSync } from '../services/sync.js';

const opSchema = z.object({
  localId: z.string().min(1),
  idempotencyKey: z.string().uuid(),
  endpoint: z.string().min(1),
  body: z.unknown(),
});
const syncBody = z.object({ operations: z.array(opSchema).max(500) });

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sync/state', async () => getSyncState(app.db));

  app.post('/sync', async (req) => {
    const { operations } = syncBody.parse(req.body);
    return runSync(app.db, operations);
  });
}
