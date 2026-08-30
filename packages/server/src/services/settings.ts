import { AppError, printSettingsSchema } from '@inventory/shared';
import type { Queryable } from '../db/client.js';
import { writeAudit } from './audit.js';

export type NegativeStockMode = 'ALLOW' | 'PREVENT';

export async function getSetting<T = unknown>(db: Queryable, key: string): Promise<T> {
  const { rows } = await db.query<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key]);
  if (rows.length === 0) throw new AppError('INTERNAL', { userMessage: `missing setting ${key}` });
  return rows[0]!.value;
}

export async function getNegativeStockMode(db: Queryable): Promise<NegativeStockMode> {
  const v = await getSetting<string>(db, 'negative_stock_mode');
  return v === 'PREVENT' ? 'PREVENT' : 'ALLOW';
}

export async function getCurrentFiscalYear(db: Queryable): Promise<number> {
  return Number(await getSetting<number>(db, 'current_fiscal_year'));
}

export async function getBackdateThresholdDays(db: Queryable): Promise<number> {
  return Number(await getSetting<number>(db, 'backdate_reason_threshold_days'));
}

const MUTABLE_KEYS = new Set([
  'negative_stock_mode',
  'thai_dates',
  'backdate_reason_threshold_days',
  'backup_interval_hours',
  'cloud_backup_enabled',
  'recon_autoheal',
  'company_name',
  'company_name_en',
  'company_tax_id',
  'company_branch',
  'company_address',
  'company_phone',
  'vat_rate_default',
  'print_settings',
]);

export async function updateSettings(
  db: Queryable,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  for (const key of Object.keys(patch)) {
    if (!MUTABLE_KEYS.has(key)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `แก้ไขการตั้งค่านี้ไม่ได้: ${key}`,
      });
    }
  }
  if (patch.negative_stock_mode !== undefined && !['ALLOW', 'PREVENT'].includes(String(patch.negative_stock_mode))) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'โหมดสต็อกติดลบไม่ถูกต้อง' });
  }
  if (patch.print_settings !== undefined) {
    const r = printSettingsSchema.safeParse(patch.print_settings);
    if (!r.success) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'ตั้งค่ารูปแบบใบกำกับไม่ถูกต้อง' });
    }
    patch.print_settings = r.data; // normalised (defaults filled, numbers coerced)
  }
  for (const [key, value] of Object.entries(patch)) {
    const before = await db.query<{ value: unknown }>('SELECT value FROM settings WHERE key = $1', [key]);
    await db.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    await writeAudit(db, {
      action: 'SETTINGS_CHANGE',
      entity: 'settings',
      entityId: key,
      oldValue: before.rows[0]?.value ?? null,
      newValue: value,
    });
  }
  const all = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
  return Object.fromEntries(all.rows.map((r) => [r.key, r.value]));
}
