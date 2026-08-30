import { companyProfileIdSchema, createCompanyProfileSchema, updateCompanyProfileSchema } from '@inventory/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createCompanyProfile, getCompanyProfile, listCompanyProfiles, updateCompanyProfile } from '../services/companyProfile.js';

export async function companyProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/company-profiles', async (req) => {
    const { includeInactive } = z.object({ includeInactive: z.enum(['true', 'false']).optional() }).parse(req.query);
    return listCompanyProfiles(app.db, includeInactive === 'true');
  });
  app.post('/company-profiles', async (req, reply) =>
    reply.status(201).send(await createCompanyProfile(app.db, createCompanyProfileSchema.parse(req.body))));
  app.get('/company-profiles/:id', async (req) => getCompanyProfile(app.db, companyProfileIdSchema.parse(req.params).id));
  app.patch('/company-profiles/:id', async (req) => {
    const { id } = companyProfileIdSchema.parse(req.params);
    return updateCompanyProfile(app.db, id, updateCompanyProfileSchema.parse(req.body));
  });
}
