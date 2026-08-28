import {
  AppError,
  createAdjustmentSchema,
  createOpeningSchema,
  createPurchaseSchema,
  createReturnSchema,
  createSaleSchema,
  voidDocumentSchema,
} from '@inventory/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createAdjustment,
  createOpening,
  createPurchase,
  createReturn,
  createSale,
  voidDocument,
} from '../services/documents.js';
import type { IdempotentResult } from '../services/idempotency.js';

const uuidSchema = z.string().uuid();
const idParam = z.object({ id: z.string().uuid() });

function idempotencyKey(req: FastifyRequest): string {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'ต้องระบุ Idempotency-Key (UUID) ใน header',
    });
  }
  return parsed.data;
}

function send(reply: FastifyReply, r: IdempotentResult<unknown>): FastifyReply {
  return reply.status(r.statusCode).send({ ...(r.body as object), _replayed: r.replayed });
}

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/openings', async (req, reply) => {
    const body = createOpeningSchema.parse(req.body);
    return send(reply, await createOpening(app.db, idempotencyKey(req), body));
  });

  app.post('/purchases', async (req, reply) => {
    const body = createPurchaseSchema.parse(req.body);
    return send(reply, await createPurchase(app.db, idempotencyKey(req), body));
  });

  app.post('/sales', async (req, reply) => {
    const body = createSaleSchema.parse(req.body);
    return send(reply, await createSale(app.db, idempotencyKey(req), body));
  });

  app.post('/returns', async (req, reply) => {
    const body = createReturnSchema.parse(req.body);
    return send(reply, await createReturn(app.db, idempotencyKey(req), body));
  });

  app.post('/adjustments', async (req, reply) => {
    const body = createAdjustmentSchema.parse(req.body);
    return send(reply, await createAdjustment(app.db, idempotencyKey(req), body));
  });

  app.post('/documents/:id/void', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = voidDocumentSchema.parse(req.body);
    return send(reply, await voidDocument(app.db, idempotencyKey(req), { ...body, id }));
  });
}
