import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { buildExport, EXPORT_KINDS, type ExportKind } from '../services/exports.js';

const paramSchema = z.object({ kind: z.enum(EXPORT_KINDS) });
const querySchema = z.object({
  productId: z.string().uuid().optional(),
  ym: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  companyProfileId: z.string().uuid().optional(),
});

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/exports/:kind', async (req, reply: FastifyReply) => {
    const rawKind = (req.params as { kind: string }).kind.replace(/\.xlsx$/, '');
    const { kind } = paramSchema.parse({ kind: rawKind });
    const q = querySchema.parse(req.query);
    const { buffer, filename } = await buildExport(app.db, kind as ExportKind, q);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });
}
