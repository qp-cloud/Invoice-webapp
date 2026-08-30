import { defaultPrintSettings, printSettingsSchema, type PrintSettings } from '@inventory/shared';
import type { Queryable } from '../db/client.js';

/** Tax-invoice print layout from the `print_settings` row; defaults if absent/invalid. */
export async function getPrintSettings(db: Queryable): Promise<PrintSettings> {
  const { rows } = await db.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = 'print_settings'`,
  );
  if (!rows[0]) return defaultPrintSettings();
  const parsed = printSettingsSchema.safeParse(rows[0].value);
  return parsed.success ? parsed.data : defaultPrintSettings();
}
