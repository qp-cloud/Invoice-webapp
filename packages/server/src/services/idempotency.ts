import { createHash } from 'node:crypto';
import { AppError } from '@inventory/shared';
import type { Database, Queryable } from '../db/client.js';

export function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key value|unique constraint|23505/i.test(msg);
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

async function readStored<T>(
  db: Queryable,
  key: string,
  requestHash: string,
): Promise<IdempotentResult<T> | null> {
  const res = await db.query<{ request_hash: string; response_json: T; status_code: number }>(
    'SELECT request_hash, response_json, status_code FROM processed_requests WHERE idempotency_key = $1',
    [key],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.request_hash !== requestHash) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY');
  }
  return { statusCode: row.status_code, body: row.response_json, replayed: true };
}

/**
 * Idempotency contract (API.md §2.1, spec §14.1). The work in `fn` AND the stored
 * response are written in one transaction, so there is no crash window that could
 * double-apply. A repeat with the same key + body returns the stored response and runs
 * nothing; a repeat with a different body -> 422.
 */
export async function runIdempotent<T>(
  db: Database,
  opts: { key: string; endpoint: string; body: unknown },
  fn: (tx: Queryable) => Promise<{ statusCode: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const requestHash = hashBody(opts.body);

  const pre = await readStored<T>(db, opts.key, requestHash);
  if (pre) return pre;

  try {
    return await db.transaction(async (tx) => {
      const result = await fn(tx);
      await tx.query(
        `INSERT INTO processed_requests (idempotency_key, endpoint, request_hash, response_json, status_code)
         VALUES ($1, $2, $3, $4, $5)`,
        [opts.key, opts.endpoint, requestHash, JSON.stringify(result.body), result.statusCode],
      );
      return { statusCode: result.statusCode, body: result.body, replayed: false };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await readStored<T>(db, opts.key, requestHash);
      if (raced) return raced;
    }
    throw err;
  }
}
