import { AppError } from '@inventory/shared';
import type { Queryable } from '../db/client.js';
import { getBackdateThresholdDays } from './settings.js';

export interface BackdateCheck {
  backdated: boolean;
  daysAgo: number;
  reasonRequired: boolean;
  warnings: string[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/**
 * Backdated-transaction policy (spec §6.3). A date before today warns; a date older than
 * `backdate_reason_threshold_days` requires a reason, which is echoed into the audit log.
 */
export async function checkBackdate(
  db: Queryable,
  occurredOn: string,
  reason: string | undefined,
): Promise<BackdateCheck> {
  const today = todayIso();
  if (occurredOn >= today) {
    return { backdated: false, daysAgo: 0, reasonRequired: false, warnings: [] };
  }
  const daysAgo = daysBetween(occurredOn, today);
  const threshold = await getBackdateThresholdDays(db);
  const reasonRequired = daysAgo > threshold;
  if (reasonRequired && (!reason || reason.trim() === '')) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `ต้องระบุเหตุผลสำหรับรายการย้อนหลัง ${daysAgo} วัน`,
      details: { occurredOn, today, daysAgo, threshold },
    });
  }
  return { backdated: true, daysAgo, reasonRequired, warnings: ['BACKDATED'] };
}
