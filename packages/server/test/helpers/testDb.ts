import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPgDatabase } from '../../src/db/pg.js';

const PG_URL_FILE = join(import.meta.dirname, '..', '.pg-url');

function pgBaseUrl(): string | null {
  if (!process.env.TEST_PG || !existsSync(PG_URL_FILE)) return null;
  return readFileSync(PG_URL_FILE, 'utf8').trim();
}

/**
 * A fresh, fully-migrated database for one test file. Default: in-memory PGlite.
 * With `TEST_PG=1` (and the embedded server booted by globalSetup): a brand-new
 * database on the real PostgreSQL instance, giving genuine multi-client behaviour.
 */
export async function makeTestDb(): Promise<Database> {
  const base = pgBaseUrl();
  if (base) {
    const name = `t_${randomUUID().replace(/-/g, '')}`;
    const admin = createPgDatabase({ connectionString: base, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.close();
    const url = base.replace(/\/[^/]+$/, `/${name}`);
    const db = createPgDatabase({ connectionString: url, max: 20 });
    await runMigrations(db);
    return db;
  }

  const db = createDb({ dataDir: 'memory' });
  await runMigrations(db);
  return db;
}

/** True when the active test database is real PostgreSQL (not PGlite). */
export const usingRealPostgres = (): boolean => pgBaseUrl() !== null;
