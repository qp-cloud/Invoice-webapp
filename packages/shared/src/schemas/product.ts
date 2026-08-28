import { z } from 'zod';
import { zPagination, zQtyString, zQueryBool, zUuid } from './common.js';

export const createProductSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  categoryId: zUuid.nullish(),
  unitCode: z.string().min(1).max(20),
  minStock: zQtyString.default('0'),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    categoryId: zUuid.nullable().optional(),
    unitCode: z.string().min(1).max(20).optional(),
    minStock: zQtyString.optional(),
    active: z.boolean().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: 'no fields to update' });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  categoryId: zUuid.optional(),
  status: z.enum(['normal', 'low', 'out']).optional(),
  lowStockOnly: zQueryBool.optional(),
  oversoldOnly: zQueryBool.optional(),
  active: zQueryBool.optional(),
  sort: z.enum(['sku', 'name', 'qtyOnHand', 'minStock', 'updatedAt']).default('sku'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  ...zPagination,
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const createCategorySchema = z.object({ name: z.string().trim().min(1).max(100) });
export const createUnitSchema = z.object({
  code: z.string().trim().min(1).max(20),
  nameTh: z.string().trim().min(1).max(50),
  baseUnitCode: z.string().min(1).max(20).nullish(),
  factor: z.number().positive().nullish(),
});
