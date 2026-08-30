import {
  AppError,
  createInvoiceSchema,
  listInvoicesQuerySchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
} from '@inventory/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  confirmInvoice,
  createInvoice,
  getInvoiceDetail,
  listInvoices,
  updateInvoice,
  voidInvoice,
} from '../services/invoices.js';

const idParam = z.object({ id: z.string().uuid() });

function idempotencyKey(req: FastifyRequest): string {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'ต้องระบุ Idempotency-Key (UUID) ใน header' });
  }
  return parsed.data;
}

const send = (reply: FastifyReply, r: { statusCode: number; body: unknown; replayed: boolean }): FastifyReply =>
  reply.status(r.statusCode).send({ ...(r.body as object), _replayed: r.replayed });

export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/invoices', async (req) => listInvoices(app.db, listInvoicesQuerySchema.parse(req.query)));

  app.post('/invoices', async (req, reply) => {
    const body = createInvoiceSchema.parse(req.body);
    return reply.status(201).send(await createInvoice(app.db, body));
  });

  app.get('/invoices/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return getInvoiceDetail(app.db, id);
  });

  app.patch('/invoices/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return updateInvoice(app.db, id, updateInvoiceSchema.parse(req.body));
  });

  app.post('/invoices/:id/confirm', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return send(reply, await confirmInvoice(app.db, id, idempotencyKey(req)));
  });

  app.post('/invoices/:id/void', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { reason } = voidInvoiceSchema.parse(req.body);
    return send(reply, await voidInvoice(app.db, id, idempotencyKey(req), reason));
  });
}
