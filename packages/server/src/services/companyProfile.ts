import type { Queryable } from '../db/client.js';

export interface CompanyProfile {
  name: string;
  nameEn: string;
  taxId: string;
  branch: string;
  address: string;
  phone: string;
}

const KEYS: Record<keyof CompanyProfile, string> = {
  name: 'company_name',
  nameEn: 'company_name_en',
  taxId: 'company_tax_id',
  branch: 'company_branch',
  address: 'company_address',
  phone: 'company_phone',
};

/** Seller identity for tax invoices, from the `settings` table (migration 0004). */
export async function getCompanyProfile(db: Queryable): Promise<CompanyProfile> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM settings WHERE key = ANY($1)`,
    [Object.values(KEYS)],
  );
  const map = new Map(rows.map((r) => [r.key, String(r.value ?? '')]));
  const out = {} as CompanyProfile;
  for (const [field, key] of Object.entries(KEYS) as [keyof CompanyProfile, string][]) {
    out[field] = map.get(key) ?? '';
  }
  return out;
}
