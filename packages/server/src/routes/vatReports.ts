import { vatReportQuerySchema } from '@inventory/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { vatReport } from '../services/vatReports.js';

const kindParam = z.object({ kind: z.enum(['purchase', 'sales']) });

export async function vatReportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/vat-reports/:kind', async (req) => {
    const { kind } = kindParam.parse(req.params);
    const { ym } = vatReportQuerySchema.parse(req.query);
    return vatReport(app.db, kind, ym);
  });
}
