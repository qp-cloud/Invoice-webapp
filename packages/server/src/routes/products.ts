import {
  AppError,
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from '@inventory/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createProduct,
  getProductById,
  listProducts,
  updateProduct,
} from '../services/products.js';

const idParam = z.object({ id: z.string().uuid() });

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get('/products', async (req) => {
    const query = listProductsQuerySchema.parse(req.query);
    return listProducts(app.db, query);
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
    return {
      ...product.stock,
      minStock: product.minStock,
      // fyView is populated once the ledger exists (Phase 3).
      fyView: { stock68: '0', purchasesCfy: '0', salesCfy: '0', variance: '0' },
    };
  });
}
