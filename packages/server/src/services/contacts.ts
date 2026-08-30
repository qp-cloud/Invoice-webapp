import { randomUUID } from 'node:crypto';
import {
  AppError,
  type CreateContactInput,
  type ListContactsQuery,
  type UpdateContactInput,
} from '@inventory/shared';
import type { Database, Queryable } from '../db/client.js';
import { camelize } from '../db/rows.js';
import { writeAudit } from './audit.js';

export interface Contact {
  id: string;
  kind: 'SUPPLIER' | 'CUSTOMER' | 'BOTH';
  name: string;
  taxId: string | null;
  branch: string | null;
  address: string | null;
  phone: string | null;
  note: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const shape = (r: Record<string, unknown>): Contact => camelize<Contact>(r);

export async function getContact(db: Queryable, id: string): Promise<Contact | null> {
  const { rows } = await db.query('SELECT * FROM contacts WHERE id = $1', [id]);
  return rows[0] ? shape(rows[0]) : null;
}

/** Assert a contact exists and can act in the given role for a doc type. */
export async function assertContactForDoc(
  db: Queryable,
  id: string,
  docType: 'BUY' | 'SELL',
): Promise<Contact> {
  const c = await getContact(db, id);
  if (!c || !c.active) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบผู้ติดต่อ' });
  const need = docType === 'BUY' ? 'SUPPLIER' : 'CUSTOMER';
  if (c.kind !== need && c.kind !== 'BOTH') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: docType === 'BUY' ? 'ผู้ติดต่อนี้ไม่ใช่ผู้ขาย/ซัพพลายเออร์' : 'ผู้ติดต่อนี้ไม่ใช่ลูกค้า',
    });
  }
  return c;
}

export async function createContact(db: Database, input: CreateContactInput): Promise<Contact> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO contacts (id, kind, name, tax_id, branch, address, phone, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id, input.kind, input.name, input.taxId ?? null, input.branch ?? null,
      input.address ?? null, input.phone ?? null, input.note ?? null,
    ],
  );
  await writeAudit(db, { action: 'CREATE', entity: 'contact', entityId: id, newValue: input });
  return (await getContact(db, id))!;
}

const COLUMN: Record<string, string> = {
  kind: 'kind', name: 'name', taxId: 'tax_id', branch: 'branch',
  address: 'address', phone: 'phone', note: 'note', active: 'active',
};

export async function updateContact(
  db: Database,
  id: string,
  patch: UpdateContactInput,
): Promise<Contact> {
  const before = await getContact(db, id);
  if (!before) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบผู้ติดต่อ' });

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(COLUMN)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  }
  params.push(id);
  await db.query(`UPDATE contacts SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
  await writeAudit(db, { action: 'UPDATE', entity: 'contact', entityId: id, oldValue: before, newValue: patch });
  return (await getContact(db, id))!;
}

export interface ContactPage {
  rows: Contact[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listContacts(db: Queryable, q: ListContactsQuery): Promise<ContactPage> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.kind) {
    params.push(q.kind);
    where.push(`(kind = $${params.length} OR kind = 'BOTH')`);
  }
  if (q.active !== undefined) {
    params.push(q.active);
    where.push(`active = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${q.q.toLowerCase()}%`);
    where.push(`(lower(name) LIKE $${params.length} OR tax_id LIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM contacts ${whereSql}`, params);
  const total = Number(countRes.rows[0]?.n ?? 0);
  const offset = (q.page - 1) * q.pageSize;
  const listRes = await db.query(
    `SELECT * FROM contacts ${whereSql} ORDER BY lower(name) LIMIT ${q.pageSize} OFFSET ${offset}`,
    params,
  );
  return {
    rows: listRes.rows.map(shape),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}
