import pg from 'pg';
import type { Database, Queryable } from './client.js';

// Keep DATE (oid 1082), TIMESTAMP, TIMESTAMPTZ as plain strings — business dates are
// handled as 'YYYY-MM-DD' strings throughout, matching the PGlite adapter (spec §7.3).
pg.types.setTypeParser(1082, (v) => v);
// int8 / numeric already arrive as strings by default in node-postgres.

const { Pool } = pg;

function asQueryable(runner: {
  query: (text: string, params?: unknown[]) => Promise<pg.QueryResult>;
}): Queryable {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await runner.query(sql, params);
      return { rows: res.rows as T[], affectedRows: res.rowCount ?? undefined };
    },
    async exec(sql: string) {
      // simple-query protocol: allows multiple statements, no bind params
      await runner.query(sql);
    },
  };
}

export interface CreatePgOptions {
  connectionString: string;
  max?: number;
}

/**
 * A `Database` backed by a real PostgreSQL server (node-postgres Pool). Same surface as
 * the PGlite adapter so services are driver-agnostic (ARCHITECTURE.md §2). Used for the
 * production path and for real-concurrency / stress tests via `embedded-postgres`.
 */
export function createPgDatabase(opts: CreatePgOptions): Database {
  const pool = new Pool({ connectionString: opts.connectionString, max: opts.max ?? 10 });

  return {
    ...asQueryable(pool),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(asQueryable(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* connection already broken */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
