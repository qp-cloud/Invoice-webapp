import { randomUUID } from 'node:crypto';
import { AppError } from '@inventory/shared';
import type { Queryable } from '../db/client.js';
import { camelizeRows } from '../db/rows.js';

export interface Category {
  id: string;
  name: string;
  createdAt: string;
}
export interface Unit {
  code: string;
  nameTh: string;
  baseUnitCode: string | null;
  factor: string | null;
  createdAt: string;
}

export async function listCategories(db: Queryable): Promise<Category[]> {
  const { rows } = await db.query('SELECT * FROM categories ORDER BY name');
  return camelizeRows<Category>(rows);
}

export async function createCategory(db: Queryable, name: string): Promise<Category> {
  const dup = await db.query('SELECT 1 FROM categories WHERE lower(name) = lower($1)', [name]);
  if (dup.rows.length > 0) {
    throw new AppError('CONFLICT', { userMessage: 'มีหมวดหมู่นี้อยู่แล้ว' });
  }
  const id = randomUUID();
  await db.query('INSERT INTO categories (id, name) VALUES ($1, $2)', [id, name]);
  return { id, name, createdAt: new Date().toISOString() };
}

export async function updateCategory(
  db: Queryable,
  id: string,
  name: string,
): Promise<Category> {
  const dup = await db.query(
    'SELECT 1 FROM categories WHERE lower(name) = lower($1) AND id <> $2',
    [name, id],
  );
  if (dup.rows.length > 0) {
    throw new AppError('CONFLICT', { userMessage: 'มีหมวดหมู่นี้อยู่แล้ว' });
  }
  const res = await db.query('UPDATE categories SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
  if (res.rows.length === 0) throw new AppError('NOT_FOUND');
  return camelizeRows<Category>(res.rows)[0]!;
}

export async function deleteCategory(db: Queryable, id: string): Promise<void> {
  const inUse = await db.query('SELECT 1 FROM products WHERE category_id = $1 LIMIT 1', [id]);
  if (inUse.rows.length > 0) throw new AppError('CATEGORY_IN_USE');
  const res = await db.query('DELETE FROM categories WHERE id = $1', [id]);
  if ((res.affectedRows ?? 0) === 0) throw new AppError('NOT_FOUND');
}

export async function listUnits(db: Queryable): Promise<Unit[]> {
  const { rows } = await db.query('SELECT * FROM units ORDER BY code');
  return camelizeRows<Unit>(rows);
}

export async function createUnit(
  db: Queryable,
  input: { code: string; nameTh: string; baseUnitCode?: string | null; factor?: number | null },
): Promise<Unit> {
  const dup = await db.query('SELECT 1 FROM units WHERE code = $1', [input.code]);
  if (dup.rows.length > 0) throw new AppError('CONFLICT', { userMessage: 'มีหน่วยนับนี้อยู่แล้ว' });
  await db.query(
    'INSERT INTO units (code, name_th, base_unit_code, factor) VALUES ($1, $2, $3, $4)',
    [input.code, input.nameTh, input.baseUnitCode ?? null, input.factor ?? null],
  );
  return {
    code: input.code,
    nameTh: input.nameTh,
    baseUnitCode: input.baseUnitCode ?? null,
    factor: input.factor != null ? String(input.factor) : null,
    createdAt: new Date().toISOString(),
  };
}
