import type { Queryable } from '../db/client.js';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'VOID'
  | 'CLOSE_PERIOD'
  | 'REOPEN_PERIOD'
  | 'ROLL_FISCAL_YEAR'
  | 'IMPORT_COMMIT'
  | 'BACKUP'
  | 'RESTORE'
  | 'COST_BASIS_RESET'
  | 'SETTINGS_CHANGE';

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

/** Append one row to audit_log (spec §20). Call inside the same tx as the change. */
export async function writeAudit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (action, entity, entity_id, old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      e.action,
      e.entity,
      e.entityId,
      e.oldValue === undefined ? null : JSON.stringify(e.oldValue),
      e.newValue === undefined ? null : JSON.stringify(e.newValue),
      e.reason ?? null,
    ],
  );
}
