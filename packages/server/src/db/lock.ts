import { createHash } from 'node:crypto';
import type { Queryable } from './client.js';
import { logger } from '../logger.js';

let advisoryLockUnavailableWarned = false;

/** Stable signed 64-bit key from a uuid, for pg_advisory_xact_lock(bigint). */
function lockKey(id: string): bigint {
  const h = createHash('sha1').update(id).digest();
  // take 8 bytes -> BigInt, then fit into signed 64-bit range
  const u = h.readBigUInt64BE(0);
  return BigInt.asIntN(64, u);
}

/**
 * Serialize stock-changing work per product (spec §14.2, DATABASE.md §4.1).
 * Must be called inside a transaction. On a single-connection PGlite this is a
 * near no-op but keeps the production code path correct; on real PostgreSQL it
 * gives the deterministic A-sells-80 / B-sells-50 result.
 */
export async function advisoryXactLock(tx: Queryable, productId: string): Promise<void> {
  try {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [lockKey(productId).toString()]);
  } catch (err) {
    if (!advisoryLockUnavailableWarned) {
      advisoryLockUnavailableWarned = true;
      logger.warn(
        { err },
        'pg_advisory_xact_lock unavailable (PGlite); relying on serialized execution',
      );
    }
  }
}
