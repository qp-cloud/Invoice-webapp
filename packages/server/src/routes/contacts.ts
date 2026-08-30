import {
  AppError,
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
} from '@inventory/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createContact, getContact, listContacts, updateContact } from '../services/contacts.js';

const idParam = z.object({ id: z.string().uuid() });

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.get('/contacts', async (req) => listContacts(app.db, listContactsQuerySchema.parse(req.query)));

  app.post('/contacts', async (req, reply) => {
    const body = createContactSchema.parse(req.body);
    return reply.status(201).send(await createContact(app.db, body));
  });

  app.get('/contacts/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const c = await getContact(app.db, id);
    if (!c) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบผู้ติดต่อ' });
    return c;
  });

  app.patch('/contacts/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return updateContact(app.db, id, updateContactSchema.parse(req.body));
  });
}
