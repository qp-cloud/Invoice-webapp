import { AppError } from '@inventory/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { commitImport, type CommitMode } from '../services/import/commit.js';
import { IMPORT_KINDS, type ImportKind } from '../services/import/headers.js';
import { invalidRowsWorkbook } from '../services/import/invalidRows.js';
import { createImport, discardImport, getImportPreview } from '../services/import/pipeline.js';

const idParam = z.object({ batchId: z.string().uuid() });
const previewQuery = z.object({ invalidOnly: z.enum(['true', 'false']).optional() });
const commitBody = z.object({
  mode: z.enum(['ALL_OR_NOTHING', 'PARTIAL']).default('ALL_OR_NOTHING'),
  acknowledgeDuplicateFile: z.boolean().optional(),
});

function idempotencyKey(req: FastifyRequest): string {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'ต้องระบุ Idempotency-Key (UUID) ใน header' });
  }
  return parsed.data;
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post('/imports', async (req) => {
    let kind: string | undefined;
    let filename = 'upload.xlsx';
    let buffer: Buffer | undefined;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        filename = part.filename || filename;
        buffer = await part.toBuffer();
      } else if (part.fieldname === 'kind') {
        kind = String(part.value);
      }
    }

    if (!buffer) throw new AppError('VALIDATION_FAILED', { userMessage: 'ต้องแนบไฟล์' });
    if (!kind || !IMPORT_KINDS.includes(kind as ImportKind)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'ต้องระบุ kind (MASTER_STOCK / PURCHASES / SALES)',
      });
    }
    return createImport(app.db, { kind: kind as ImportKind, filename, buffer });
  });

  app.get('/imports/:batchId', async (req) => {
    const { batchId } = idParam.parse(req.params);
    const q = previewQuery.parse(req.query);
    return getImportPreview(app.db, batchId, { invalidOnly: q.invalidOnly === 'true' });
  });

  app.post('/imports/:batchId/commit', async (req, reply: FastifyReply) => {
    const { batchId } = idParam.parse(req.params);
    const body = commitBody.parse(req.body ?? {});
    const r = await commitImport(
      app.db,
      batchId,
      { mode: body.mode as CommitMode, acknowledgeDuplicateFile: body.acknowledgeDuplicateFile },
      idempotencyKey(req),
    );
    return reply.status(r.statusCode).send({ ...r.body, _replayed: r.replayed });
  });

  app.post('/imports/:batchId/discard', async (req) => {
    const { batchId } = idParam.parse(req.params);
    return discardImport(app.db, batchId);
  });

  app.get('/imports/:batchId/invalid-rows.xlsx', async (req, reply: FastifyReply) => {
    const { batchId } = idParam.parse(req.params);
    const buf = await invalidRowsWorkbook(app.db, batchId);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="invalid-rows-${batchId}.xlsx"`)
      .send(buf);
  });
}
