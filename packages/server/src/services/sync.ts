import {
  AppError,
  createAdjustmentSchema,
  createPurchaseSchema,
  createReturnSchema,
  createSaleSchema,
} from '@inventory/shared';
import { ZodError } from 'zod';
import type { z } from 'zod';
import type { Database } from '../db/client.js';
import {
  createAdjustment,
  createPurchase,
  createReturn,
  createSale,
} from './documents.js';
import { getNegativeStockMode } from './settings.js';

export interface SyncState {
  serverTime: string;
  currentFiscalYear: number;
  openPeriods: string[];
  negativeStockMode: 'ALLOW' | 'PREVENT';
}

export async function getSyncState(db: Database): Promise<SyncState> {
  const fy = await db.query<{ value: number }>(
    `SELECT value FROM settings WHERE key = 'current_fiscal_year'`,
  );
  const periods = await db.query<{ ym: string }>(
    `SELECT ym FROM periods WHERE status = 'OPEN' ORDER BY ym`,
  );
  return {
    serverTime: new Date().toISOString(),
    currentFiscalYear: Number(fy.rows[0]?.value ?? 0),
    openPeriods: periods.rows.map((r) => r.ym),
    negativeStockMode: await getNegativeStockMode(db),
  };
}

export interface SyncOperation {
  localId: string;
  idempotencyKey: string;
  endpoint: string;
  body?: unknown;
}

export type SyncResult =
  | { localId: string; status: 'SYNCED'; serverId: string | null; response: unknown; replayed: boolean }
  | { localId: string; status: 'CONFLICT'; code: string; message: string; details?: unknown };

type Handler = (db: Database, key: string, body: unknown) => Promise<{ statusCode: number; body: unknown; replayed: boolean }>;

const parseWith =
  <T>(schema: z.ZodType<T>, fn: (db: Database, key: string, input: T) => Promise<{ statusCode: number; body: unknown; replayed: boolean }>): Handler =>
  (db, key, body) =>
    fn(db, key, schema.parse(body));

/** Only the operations that spec §12.1 permits offline. */
const HANDLERS: Record<string, Handler> = {
  '/purchases': parseWith(createPurchaseSchema, (db, key, input) => createPurchase(db, key, input)),
  '/sales': parseWith(createSaleSchema, (db, key, input) => createSale(db, key, input)),
  '/returns': parseWith(createReturnSchema, (db, key, input) => createReturn(db, key, input)),
  '/adjustments': parseWith(createAdjustmentSchema, (db, key, input) => createAdjustment(db, key, input)),
};

/**
 * Batch flush (spec §12.2, API.md §13). Operations run in array order, one at a time.
 * A typed 4xx becomes a CONFLICT entry and the batch continues; a 5xx aborts the batch
 * so the client retries the unsynced remainder with the same idempotency keys.
 */
export async function runSync(db: Database, operations: SyncOperation[]): Promise<{ results: SyncResult[] }> {
  const results: SyncResult[] = [];

  for (const op of operations) {
    const handler = HANDLERS[op.endpoint];
    if (!handler) {
      results.push({
        localId: op.localId,
        status: 'CONFLICT',
        code: 'VALIDATION_FAILED',
        message: `ปลายทางไม่รองรับการซิงค์: ${op.endpoint}`,
      });
      continue;
    }

    try {
      const r = await handler(db, op.idempotencyKey, op.body);
      const serverId = (r.body as { id?: string } | null)?.id ?? null;
      results.push({
        localId: op.localId,
        status: 'SYNCED',
        serverId,
        response: r.body,
        replayed: r.replayed,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        results.push({
          localId: op.localId,
          status: 'CONFLICT',
          code: 'VALIDATION_FAILED',
          message: 'ข้อมูลไม่ถูกต้อง',
          details: { issues: err.issues },
        });
        continue;
      }
      if (AppError.is(err) && err.httpStatus >= 400 && err.httpStatus < 500) {
        results.push({
          localId: op.localId,
          status: 'CONFLICT',
          code: err.code,
          message: err.userMessage,
          details: err.details,
        });
        continue;
      }
      throw err; // 5xx / unexpected -> abort, client retries remainder
    }
  }

  return { results };
}
