import { AppError } from '@inventory/shared';
import type { Database, Queryable } from '../db/client.js';
import { writeAudit } from './audit.js';
import { ensurePeriod } from './periods.js';
import { getCurrentFiscalYear } from './settings.js';

export interface RollFiscalYearInput {
  confirm: boolean;
  /**
   * Owner attests a fresh full backup exists. The automated backup subsystem is
   * Phase 8; until it lands this is the guard that stands in for "a backup
   * succeeded first" (spec §6.5 step 2, API.md §6). A Phase 8 backup run will set
   * `settings.last_backup_at` and this flag becomes unnecessary.
   */
  backupConfirmed?: boolean;
}

export interface RollFiscalYearResult {
  previousFiscalYear: number;
  currentFiscalYear: number;
  periodsOpenedForNewYear: string[];
}

async function assertBackupTaken(tx: Queryable, confirmed: boolean): Promise<void> {
  if (confirmed) return;
  const { rows } = await tx.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'last_backup_at'`,
  );
  const raw = rows[0]?.value;
  const last = raw ? Date.parse(String(raw).replace(/^"|"$/g, '')) : NaN;
  const freshEnough = Number.isFinite(last) && Date.now() - last < 24 * 60 * 60 * 1000;
  if (!freshEnough) {
    throw new AppError('BACKUP_REQUIRED', {
      userMessage: 'ต้องสำรองข้อมูลให้สำเร็จก่อนปิดปีบัญชี',
    });
  }
}

/**
 * Explicit, owner-triggered fiscal-year rollover (spec §6.5). Guards: `confirm`,
 * all 12 monthly periods of the outgoing year CLOSED, a backup taken. Advances
 * `settings.current_fiscal_year` and opens the 12 periods of the new year. Moves no
 * ledger data — "Stock 68" for the new year is derived from the ledger cutoff.
 */
export async function rollFiscalYear(
  db: Database,
  input: RollFiscalYearInput,
): Promise<RollFiscalYearResult> {
  if (!input.confirm) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'ต้องยืนยันการปิดปีบัญชี' });
  }
  return db.transaction(async (tx) => {
    const cfy = await getCurrentFiscalYear(tx);
    const gregYear = cfy - 543;

    const periods = await tx.query<{ ym: string; status: 'OPEN' | 'CLOSED' }>(
      `SELECT ym, status FROM periods WHERE ym LIKE $1 ORDER BY ym`,
      [`${gregYear}-%`],
    );
    const closed = periods.rows.filter((p) => p.status === 'CLOSED').map((p) => p.ym);
    if (closed.length !== 12) {
      throw new AppError('FY_PERIODS_OPEN', {
        details: {
          fiscalYear: cfy,
          closedCount: closed.length,
          open: periods.rows.filter((p) => p.status !== 'CLOSED').map((p) => p.ym),
          missing: 12 - periods.rows.length,
        },
      });
    }

    await assertBackupTaken(tx, input.backupConfirmed ?? false);

    const newCfy = cfy + 1;
    await tx.query(
      `UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = 'current_fiscal_year'`,
      [JSON.stringify(newCfy)],
    );

    const newGreg = newCfy - 543;
    const opened: string[] = [];
    for (let m = 1; m <= 12; m += 1) {
      const ym = `${newGreg}-${String(m).padStart(2, '0')}`;
      await ensurePeriod(tx, ym);
      opened.push(ym);
    }

    await writeAudit(tx, {
      action: 'ROLL_FISCAL_YEAR',
      entity: 'settings',
      entityId: 'current_fiscal_year',
      oldValue: { fiscalYear: cfy },
      newValue: { fiscalYear: newCfy },
    });

    return {
      previousFiscalYear: cfy,
      currentFiscalYear: newCfy,
      periodsOpenedForNewYear: opened,
    };
  });
}
