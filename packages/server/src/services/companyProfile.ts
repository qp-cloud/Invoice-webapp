import {
  AppError,
  defaultPrintSettings,
  printSettingsSchema,
  type CreateCompanyProfileInput,
  type PrintSettings,
  type UpdateCompanyProfileInput,
} from '@inventory/shared';
import type { Queryable } from '../db/client.js';
import { writeAudit } from './audit.js';

export interface CompanyProfile {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  taxId: string;
  branch: string;
  address: string;
  phone: string;
  printSettings: PrintSettings;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

type ProfileRow = {
  id: string; code: string; name: string; name_en: string; tax_id: string; branch: string;
  address: string; phone: string; print_settings: unknown; active: boolean; created_at: string; updated_at: string;
};

function shapeProfile(row: ProfileRow): CompanyProfile {
  const parsed = printSettingsSchema.safeParse(row.print_settings);
  return {
    id: row.id, code: row.code, name: row.name, nameEn: row.name_en, taxId: row.tax_id,
    branch: row.branch, address: row.address, phone: row.phone,
    printSettings: parsed.success ? parsed.data : defaultPrintSettings(),
    active: row.active, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listCompanyProfiles(db: Queryable, includeInactive = false): Promise<CompanyProfile[]> {
  const { rows } = await db.query<ProfileRow>(
    `SELECT * FROM company_profiles ${includeInactive ? '' : 'WHERE active'} ORDER BY active DESC, name, code`,
  );
  return rows.map(shapeProfile);
}

/** Fetch a selected profile, or the first active profile for backwards-compatible callers. */
export async function getCompanyProfile(db: Queryable, id?: string): Promise<CompanyProfile> {
  const { rows } = await db.query<ProfileRow>(
    id ? 'SELECT * FROM company_profiles WHERE id = $1' : 'SELECT * FROM company_profiles WHERE active ORDER BY created_at LIMIT 1',
    id ? [id] : [],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', { userMessage: 'ไม่พบโปรไฟล์บริษัท' });
  return shapeProfile(rows[0]);
}

export async function assertActiveCompanyProfile(db: Queryable, id: string): Promise<CompanyProfile> {
  const profile = await getCompanyProfile(db, id);
  if (!profile.active) throw new AppError('VALIDATION_FAILED', { userMessage: 'โปรไฟล์บริษัทนี้ถูกปิดใช้งาน' });
  return profile;
}

export async function createCompanyProfile(db: Queryable, input: CreateCompanyProfileInput): Promise<CompanyProfile> {
  const { rows } = await db.query<ProfileRow>(
    `INSERT INTO company_profiles (code, name, name_en, tax_id, branch, address, phone, print_settings)
     VALUES (upper($1), $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [input.code, input.name, input.nameEn, input.taxId, input.branch, input.address, input.phone,
      JSON.stringify(input.printSettings ?? defaultPrintSettings())],
  );
  const profile = shapeProfile(rows[0]!);
  await writeAudit(db, { action: 'CREATE', entity: 'company_profile', entityId: profile.id, newValue: profile });
  return profile;
}

export async function updateCompanyProfile(db: Queryable, id: string, patch: UpdateCompanyProfileInput): Promise<CompanyProfile> {
  await getCompanyProfile(db, id);
  if (patch.active === false) {
    const active = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM company_profiles WHERE active AND id <> $1', [id]);
    if (Number(active.rows[0]?.n ?? 0) === 0) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'ต้องมีบริษัทที่เปิดใช้งานอย่างน้อย 1 บริษัท' });
    }
  }
  const columns: Record<string, string> = {
    code: 'code', name: 'name', nameEn: 'name_en', taxId: 'tax_id', branch: 'branch',
    address: 'address', phone: 'phone', printSettings: 'print_settings', active: 'active',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    let value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === 'code') value = String(value).toUpperCase();
    if (key === 'printSettings') value = JSON.stringify(value);
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  values.push(id);
  const { rows } = await db.query<ProfileRow>(
    `UPDATE company_profiles SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`, values,
  );
  const profile = shapeProfile(rows[0]!);
  await writeAudit(db, { action: 'SETTINGS_CHANGE', entity: 'company_profile', entityId: id, newValue: patch });
  return profile;
}
