import { buddhistYear } from '@inventory/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { closePeriod, listPeriods, reopenPeriod } from '../services/periods.js';
import { getCurrentFiscalYear } from '../services/settings.js';

const ymParam = z.object({ ym: z.string().regex(/^\d{4}-\d{2}$/) });
const reopenBody = z.object({ reason: z.string().min(1).max(500) });

export async function periodRoutes(app: FastifyInstance): Promise<void> {
  app.get('/periods', async () => listPeriods(app.db));

  app.post('/periods/:ym/close', async (req) => {
    const { ym } = ymParam.parse(req.params);
    return closePeriod(app.db, ym);
  });

  app.post('/periods/:ym/reopen', async (req) => {
    const { ym } = ymParam.parse(req.params);
    const { reason } = reopenBody.parse(req.body);
    return reopenPeriod(app.db, ym, reason);
  });

  app.get('/fiscal-year', async () => {
    const cfy = await getCurrentFiscalYear(app.db);
    const periods = await listPeriods(app.db);
    const gregYear = cfy - 543;
    const inYear = periods.filter((p) => p.ym.startsWith(String(gregYear)));
    return {
      currentFiscalYear: cfy,
      buddhistLabelYear: cfy,
      gregorianYear: gregYear,
      labels: {
        stock: `Stock ${String(cfy).slice(-2)}`,
        purchases: `ซื้อเข้า ${String(cfy).slice(-2)}`,
        sales: `ขายออก ${String(cfy).slice(-2)}`,
      },
      periodsClosed: inYear.filter((p) => p.status === 'CLOSED').length,
      periodsTotal: inYear.length,
      _bYear: buddhistYear(gregYear),
    };
  });
}
