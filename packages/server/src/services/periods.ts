import { AppError, monthLabelTh } from '@inventory/shared';
import type { Database, Queryable } from '../db/client.js';
import { writeAudit } from './audit.js';

export interface Period {
  id: string;
  ym: string;
  status: 'OPEN' | 'CLOSED';
  label: string;
  closedAt: string | null;
}

/** Gregorian YYYY-MM from a YYYY-MM-DD business date. */
export function ymOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Get the period row for a month, creating it (OPEN) if it does not exist yet. */
export async function ensurePeriod(
  db: Queryable,
  ym: string,
): Promise<{ id: string; status: 'OPEN' | 'CLOSED' }> {
  const found = await db.query<{ id: string; status: 'OPEN' | 'CLOSED' }>(
    'SELECT id, status FROM periods WHERE ym = $1',
    [ym],
  );
  if (found.rows[0]) return found.rows[0];
  const inserted = await db.query<{ id: string; status: 'OPEN' | 'CLOSED' }>(
    `INSERT INTO periods (ym, status) VALUES ($1, 'OPEN')
     ON CONFLICT (ym) DO UPDATE SET ym = EXCLUDED.ym
     RETURNING id, status`,
    [ym],
  );
  return inserted.rows[0]!;
}

/** Throw PERIOD_CLOSED if the month containing `isoDate` is closed. Returns period id. */
export async function assertPeriodOpen(db: Queryable, isoDate: string): Promise<string> {
  const { id, status } = await ensurePeriod(db, ymOf(isoDate));
  if (status === 'CLOSED') {
    throw new AppError('PERIOD_CLOSED', { details: { ym: ymOf(isoDate) } });
  }
  return id;
}

export async function listPeriods(db: Queryable): Promise<Period[]> {
  const { rows } = await db.query<{
    id: string;
    ym: string;
    status: 'OPEN' | 'CLOSED';
    closed_at: string | null;
  }>('SELECT id, ym, status, closed_at FROM periods ORDER BY ym');
  return rows.map((r) => ({
    id: r.id,
    ym: r.ym,
    status: r.status,
    label: monthLabelTh(r.ym),
    closedAt: r.closed_at,
  }));
}

export async function closePeriod(db: Database, ym: string): Promise<Period> {
  return db.transaction(async (tx) => {
    const cur = await ensurePeriod(tx, ym);
    if (cur.status === 'CLOSED') throw new AppError('PERIOD_ALREADY_CLOSED');
    await tx.query(
      `UPDATE periods SET status = 'CLOSED', closed_at = now(), closed_reason = NULL WHERE ym = $1`,
      [ym],
    );
    await writeAudit(tx, {
      action: 'CLOSE_PERIOD',
      entity: 'period',
      entityId: ym,
      oldValue: { status: 'OPEN' },
      newValue: { status: 'CLOSED' },
    });
    return (await listPeriods(tx)).find((p) => p.ym === ym)!;
  });
}

export async function reopenPeriod(db: Database, ym: string, reason: string): Promise<Period> {
  return db.transaction(async (tx) => {
    const cur = await ensurePeriod(tx, ym);
    if (cur.status === 'OPEN') throw new AppError('PERIOD_NOT_CLOSED');
    await tx.query(
      `UPDATE periods SET status = 'OPEN', reopened_at = now(), reopened_reason = $2 WHERE ym = $1`,
      [ym, reason],
    );
    await writeAudit(tx, {
      action: 'REOPEN_PERIOD',
      entity: 'period',
      entityId: ym,
      oldValue: { status: 'CLOSED' },
      newValue: { status: 'OPEN' },
      reason,
    });
    return (await listPeriods(tx)).find((p) => p.ym === ym)!;
  });
}
