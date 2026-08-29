import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rollFiscalYear } from '../services/fiscalYear.js';

const rollBody = z.object({
  confirm: z.literal(true),
  backupConfirmed: z.boolean().optional(),
});

export async function fiscalYearActionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/fiscal-year/roll', async (req) => {
    const body = rollBody.parse(req.body);
    return rollFiscalYear(app.db, body);
  });
}
