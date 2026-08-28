import { randomUUID } from 'node:crypto';
import {
  AppError,
  cleanSku,
  type CreateProductInput,
  Decimal,
  type ListProductsQuery,
  stockStatus,
  type UpdateProductInput,
} from '@inventory/shared';
import type { Database, Queryable } from '../db/client.js';
import { camelize } from '../db/rows.js';
import { writeAudit } from './audit.js';

export interface ProductStock {
  qtyOnHand: string;
  status: 'normal' | 'low' | 'out';
  oversold: boolean;
  missingBalance: string;
  avgCostSatang: number;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  unitCode: string;
  minStock: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProductWithStock = ProductRow & { stock: ProductStock };

const SELECT_WITH_STOCK = `
  SELECT p.id, p.sku, p.name, p.category_id, p.unit_code, p.min_stock,
         p.active, p.created_at, p.updated_at,
         COALESCE(ss.qty_on_hand, 0)::text            AS qty_on_hand,
         COALESCE(ss.avg_cost_micro, 0)               AS avg_cost_micro
  FROM products p
  LEFT JOIN stock_state ss ON ss.product_id = p.id
`;

function shape(row: Record<string, unknown>): ProductWithStock {
  const c = camelize<
    ProductRow & { qtyOnHand: string; avgCostMicro: number | string }
  >(row);
  const qty = new Decimal(c.qtyOnHand ?? '0');
  const minStock = new Decimal(c.minStock);
  const avgMicro = Number(c.avgCostMicro ?? 0);
  return {
    id: c.id,
    sku: c.sku,
    name: c.name,
    categoryId: c.categoryId,
    unitCode: c.unitCode,
    minStock: minStock.toString(),
    active: c.active,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    stock: {
      qtyOnHand: qty.toString(),
      status: stockStatus(qty.toString(), minStock.toString()),
      oversold: qty.lt(0),
      missingBalance: qty.lt(0) ? qty.abs().toString() : '0',
      avgCostSatang: Math.round(avgMicro / 10_000),
    },
  };
}

export async function getProductById(
  db: Queryable,
  id: string,
): Promise<ProductWithStock | null> {
  const { rows } = await db.query(`${SELECT_WITH_STOCK} WHERE p.id = $1`, [id]);
  return rows[0] ? shape(rows[0]) : null;
}

export async function getProductBySku(
  db: Queryable,
  skuRaw: string,
): Promise<ProductWithStock | null> {
  const sku = cleanSku(skuRaw);
  const { rows } = await db.query(`${SELECT_WITH_STOCK} WHERE p.sku = $1`, [sku]);
  return rows[0] ? shape(rows[0]) : null;
}

async function assertRefsExist(
  db: Queryable,
  unitCode: string,
  categoryId: string | null | undefined,
): Promise<void> {
  const u = await db.query('SELECT 1 FROM units WHERE code = $1', [unitCode]);
  if (u.rows.length === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'ไม่พบหน่วยนับนี้', details: { unitCode } });
  }
  if (categoryId) {
    const c = await db.query('SELECT 1 FROM categories WHERE id = $1', [categoryId]);
    if (c.rows.length === 0) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'ไม่พบหมวดหมู่นี้',
        details: { categoryId },
      });
    }
  }
}

export async function createProduct(
  db: Database,
  input: CreateProductInput,
): Promise<ProductWithStock> {
  const sku = cleanSku(input.sku);
  return db.transaction(async (tx) => {
    await assertRefsExist(tx, input.unitCode, input.categoryId ?? null);

    const dup = await tx.query('SELECT 1 FROM products WHERE sku = $1', [sku]);
    if (dup.rows.length > 0) {
      throw new AppError('SKU_ALREADY_EXISTS', { details: { sku } });
    }

    const id = randomUUID();
    await tx.query(
      `INSERT INTO products (id, sku, name, category_id, unit_code, min_stock)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, sku, input.name, input.categoryId ?? null, input.unitCode, input.minStock],
    );
    await tx.query('INSERT INTO stock_state (product_id) VALUES ($1)', [id]);
    await writeAudit(tx, {
      action: 'CREATE',
      entity: 'product',
      entityId: id,
      newValue: { sku, name: input.name, unitCode: input.unitCode, minStock: input.minStock },
    });

    const created = await getProductById(tx, id);
    if (!created) throw new AppError('INTERNAL');
    return created;
  });
}

const UPDATABLE: (keyof UpdateProductInput)[] = [
  'name',
  'categoryId',
  'unitCode',
  'minStock',
  'active',
];
const COLUMN: Record<string, string> = {
  name: 'name',
  categoryId: 'category_id',
  unitCode: 'unit_code',
  minStock: 'min_stock',
  active: 'active',
};

export async function updateProduct(
  db: Database,
  id: string,
  patch: UpdateProductInput,
): Promise<ProductWithStock> {
  return db.transaction(async (tx) => {
    const before = await getProductById(tx, id);
    if (!before) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบสินค้า' });

    if (patch.unitCode !== undefined || patch.categoryId !== undefined) {
      await assertRefsExist(
        tx,
        patch.unitCode ?? before.unitCode,
        patch.categoryId === undefined ? before.categoryId : patch.categoryId,
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const key of UPDATABLE) {
      if (patch[key] === undefined) continue;
      params.push(patch[key]);
      sets.push(`${COLUMN[key]} = $${params.length}`);
    }
    params.push(new Date().toISOString());
    sets.push(`updated_at = $${params.length}`);
    params.push(id);
    await tx.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    const after = await getProductById(tx, id);
    if (!after) throw new AppError('INTERNAL');
    await writeAudit(tx, {
      action: 'UPDATE',
      entity: 'product',
      entityId: id,
      oldValue: {
        name: before.name,
        categoryId: before.categoryId,
        unitCode: before.unitCode,
        minStock: before.minStock,
        active: before.active,
      },
      newValue: {
        name: after.name,
        categoryId: after.categoryId,
        unitCode: after.unitCode,
        minStock: after.minStock,
        active: after.active,
      },
    });
    return after;
  });
}

/** Import UPSERT on sanitized SKU (spec §8.3). Returns the row + which action ran. */
export async function upsertProductBySku(
  db: Database,
  input: CreateProductInput,
): Promise<{ product: ProductWithStock; action: 'CREATE' | 'UPDATE' }> {
  const sku = cleanSku(input.sku);
  const existing = await getProductBySku(db, sku);
  if (!existing) {
    return { product: await createProduct(db, { ...input, sku }), action: 'CREATE' };
  }
  const product = await updateProduct(db, existing.id, {
    name: input.name,
    unitCode: input.unitCode,
    minStock: input.minStock,
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
  });
  return { product, action: 'UPDATE' };
}

export interface ProductPage {
  rows: ProductWithStock[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const SORT_COLUMN: Record<ListProductsQuery['sort'], string> = {
  sku: 'p.sku',
  name: 'p.name',
  qtyOnHand: 'COALESCE(ss.qty_on_hand, 0)',
  minStock: 'p.min_stock',
  updatedAt: 'p.updated_at',
};

export async function listProducts(
  db: Queryable,
  q: ListProductsQuery,
): Promise<ProductPage> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown): void => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  if (q.q) {
    params.push(cleanSku(q.q));
    params.push(`%${q.q.toLowerCase()}%`);
    where.push(`(p.sku = $${params.length - 1} OR lower(p.name) LIKE $${params.length})`);
  }
  if (q.categoryId) add('p.category_id = ?', q.categoryId);
  if (q.active !== undefined) add('p.active = ?', q.active);

  const qtyExpr = 'COALESCE(ss.qty_on_hand, 0)';
  if (q.oversoldOnly) where.push(`${qtyExpr} < 0`);
  if (q.lowStockOnly) where.push(`${qtyExpr} > 0 AND ${qtyExpr} <= p.min_stock`);
  if (q.status === 'out') where.push(`${qtyExpr} <= 0`);
  if (q.status === 'low') where.push(`${qtyExpr} > 0 AND ${qtyExpr} <= p.min_stock`);
  if (q.status === 'normal') where.push(`${qtyExpr} > p.min_stock`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM products p LEFT JOIN stock_state ss ON ss.product_id = p.id ${whereSql}`,
    params,
  );
  const total = Number(countRes.rows[0]?.n ?? 0);

  const offset = (q.page - 1) * q.pageSize;
  const listRes = await db.query(
    `${SELECT_WITH_STOCK} ${whereSql}
     ORDER BY ${SORT_COLUMN[q.sort]} ${q.dir === 'desc' ? 'DESC' : 'ASC'}, p.id ASC
     LIMIT ${q.pageSize} OFFSET ${offset}`,
    params,
  );

  return {
    rows: listRes.rows.map((r) => shape(r as Record<string, unknown>)),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}
