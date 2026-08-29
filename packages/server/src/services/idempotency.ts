import { createHash } from 'node:crypto';
import { AppError } from '@inventory/shared';
import type { Database, Queryable } from '../db/client.js';
import { logger } from '../logger.js';

export function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key value|unique constraint|23505/i.test(msg);
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

/** Signed 32-bit key for pg_advisory_xact_lock, derived from the idempotency key. */
function lockKey(key: string): number {
  const h = createHash('sha1').update(`idem:${key}`).digest();
  return h.readInt32BE(0);
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

let advisoryLockUnavailableLogged = false;

async function serializeOnKey(tx: Queryable, key: string): Promise<void> {
  try {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [lockKey(key)]);
  } catch (err) {
    if (!advisoryLockUnavailableLogged) {
      advisoryLockUnavailableLogged = true;
      logger.warn({ err }, 'pg_advisory_xact_lock unavailable; idempotency relies on serialized execution');
    }
  }
}

/**
 * Idempotency contract (API.md §2.1, spec §14.1). Same key + body -> the stored response,
 * nothing re-run; same key + different body -> 422.
 *
 * Concurrency: the transaction first takes a per-key advisory lock, so parallel requests
 * with the same key run one at a time. The loser, once it holds the lock, sees the
 * winner's committed `processed_requests` row and returns it as a replay without ever
 * calling `fn` again (verified against real PostgreSQL in concurrency.test.ts).
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
      await serializeOnKey(tx, opts.key);

      const stored = await readStored<T>(tx, opts.key, requestHash);
      if (stored) return stored;

      const result = await fn(tx);
      await tx.query(
        `INSERT INTO processed_requests (idempotency_key, endpoint, request_hash, response_json, status_code)
         VALUES ($1, $2, $3, $4, $5)`,
        [opts.key, opts.endpoint, requestHash, JSON.stringify(result.body), result.statusCode],
      );
      return { statusCode: result.statusCode, body: result.body, replayed: false };
    });
  } catch (err) {
    // last-resort: a racer that slipped past the lock (e.g. PGlite without advisory locks)
    if (isUniqueViolation(err)) {
      const raced = await readStored<T>(db, opts.key, requestHash);
      if (raced) return raced;
    }
    throw err;
  }
}
