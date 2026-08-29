import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { reconcile } from '../services/reconcile.js';

const body = z.object({ autoHeal: z.boolean().optional() }).default({});

export async function reconcileRoutes(app: FastifyInstance): Promise<void> {
  app.post('/reconcile', async (req) => {
    const { autoHeal } = body.parse(req.body ?? {});
    return reconcile(app.db, { autoHeal });
  });
}
