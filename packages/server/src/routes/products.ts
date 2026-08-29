import {
  AppError,
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from '@inventory/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentFyView, getLedger } from '../services/ledger.js';
import { getCurrentFiscalYear } from '../services/settings.js';
import {
  createProduct,
  getProductById,
  listProducts,
  updateProduct,
} from '../services/products.js';

const idParam = z.object({ id: z.string().uuid() });
const ledgerQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  includeVoided: z.enum(['true', 'false']).default('true'),
});

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get('/products', async (req) => {
    const query = listProductsQuerySchema.parse(req.query);
    const cfy = await getCurrentFiscalYear(app.db);
    return listProducts(app.db, query, cfy);
  });

  app.post('/products', async (req, reply) => {
    const body = createProductSchema.parse(req.body);
    const product = await createProduct(app.db, body);
    return reply.status(201).send(product);
  });

  app.get('/products/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const product = await getProductById(app.db, id);
    if (!product) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบสินค้า' });
    return product;
  });

  app.patch('/products/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = updateProductSchema.parse(req.body);
    return updateProduct(app.db, id, body);
  });

  app.get('/products/:id/stock', async (req) => {
    const { id } = idParam.parse(req.params);
    const product = await getProductById(app.db, id);
    if (!product) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบสินค้า' });
    const cfy = await getCurrentFiscalYear(app.db);
    const fyView = await currentFyView(app.db, id, cfy);
    return { ...product.stock, minStock: product.minStock, fyView };
  });

  app.get('/products/:id/ledger', async (req) => {
    const { id } = idParam.parse(req.params);
    const q = ledgerQuery.parse(req.query);
    const product = await getProductById(app.db, id);
    if (!product) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบสินค้า' });
    return getLedger(app.db, id, {
      page: q.page,
      pageSize: q.pageSize,
      includeVoided: q.includeVoided === 'true',
    });
  });
}
