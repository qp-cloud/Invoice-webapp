import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { lowStockReport, monthlyReport, oversoldReport } from '../services/reports.js';

const monthlyQuery = z.object({ ym: z.string().regex(/^\d{4}-\d{2}$/) });

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/reports/monthly', async (req) => {
    const { ym } = monthlyQuery.parse(req.query);
    return monthlyReport(app.db, ym);
  });

  app.get('/reports/low-stock', async () => lowStockReport(app.db));

  app.get('/reports/oversold', async () => oversoldReport(app.db));
}
