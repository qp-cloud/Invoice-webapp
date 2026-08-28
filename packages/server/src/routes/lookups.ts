import { AppError, createCategorySchema, createUnitSchema } from '@inventory/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createCategory,
  createUnit,
  deleteCategory,
  listCategories,
  listUnits,
  updateCategory,
} from '../services/lookups.js';

const idParam = z.object({ id: z.string().uuid() });

export async function lookupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/categories', async () => listCategories(app.db));

  app.post('/categories', async (req, reply) => {
    const { name } = createCategorySchema.parse(req.body);
    return reply.status(201).send(await createCategory(app.db, name));
  });

  app.patch('/categories/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { name } = createCategorySchema.parse(req.body);
    return updateCategory(app.db, id, name);
  });

  app.delete('/categories/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await deleteCategory(app.db, id);
    return reply.status(204).send();
  });

  app.get('/units', async () => listUnits(app.db));

  app.post('/units', async (req, reply) => {
    const body = createUnitSchema.parse(req.body);
    if (body.baseUnitCode && body.factor == null) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'ต้องระบุอัตราส่วนเมื่อมีหน่วยฐาน',
      });
    }
    return reply.status(201).send(
      await createUnit(app.db, {
        code: body.code,
        nameTh: body.nameTh,
        baseUnitCode: body.baseUnitCode ?? null,
        factor: body.factor ?? null,
      }),
    );
  });
}
