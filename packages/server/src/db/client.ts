import { PGlite } from '@electric-sql/pglite';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createPgDatabase } from './pg.js';

/**
 * Minimal query surface the services code against. PGlite satisfies it directly;
 * a `pg` Pool adapter can satisfy it later for production / real-Postgres tests
 * (ARCHITECTURE.md §2, spec Change Log v0.3).
 */
export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
  /** Multi-statement execution (migrations, DDL). No parameters. */
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function wrap(pg: PGlite): Database {
  const asQueryable = (runner: {
    query: PGlite['query'];
    exec: PGlite['exec'];
  }): Queryable => ({
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await runner.query<T>(sql, params);
      return { rows: res.rows, affectedRows: res.affectedRows };
    },
    async exec(sql: string) {
      await runner.exec(sql);
    },
  });

  return {
    ...asQueryable(pg),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) => fn(asQueryable(tx)));
    },
    async close() {
      await pg.close();
    },
  };
}

export interface CreateDbOptions {
  /** 'memory' for ephemeral; otherwise a directory path. */
  dataDir?: string;
}

// Keep DATE (oid 1082) as a plain 'YYYY-MM-DD' string, not a JS Date — business dates
// are handled as strings throughout (spec §7.3).
const DATE_OID = 1082;
const pgliteOptions = { parsers: { [DATE_OID]: (value: string) => value } };

export function createDb(opts: CreateDbOptions = {}): Database {
  const dataDir = opts.dataDir ?? loadConfig().PGLITE_DATA_DIR;
  const pg = dataDir === 'memory' ? new PGlite(pgliteOptions) : new PGlite(dataDir, pgliteOptions);
  return wrap(pg);
}

let singleton: Database | undefined;

export function getDb(): Database {
  if (!singleton) {
    const cfg = loadConfig();
    if (cfg.DATABASE_URL) {
      singleton = createPgDatabase({ connectionString: cfg.DATABASE_URL });
      logger.info('using PostgreSQL via DATABASE_URL');
    } else {
      singleton = createDb();
    }
  }
  return singleton;
}

export async function closeDb(): Promise<void> {
  if (singleton) {
    await singleton.close();
    singleton = undefined;
  }
}
