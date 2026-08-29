import type { FastifyInstance } from 'fastify';
import { getDashboard } from '../services/dashboard.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', async () => getDashboard(app.db));
}
