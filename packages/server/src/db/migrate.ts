import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './client.js';
import { closeDb, getDb } from './client.js';
import { logger } from '../logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface AppliedMigration {
  id: string;
  applied_at: string;
}

async function ensureMigrationsTable(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

/** Apply every migration file not yet recorded in `_migrations`. Idempotent. */
export async function runMigrations(db: Database): Promise<string[]> {
  await ensureMigrationsTable(db);
  const { rows } = await db.query<{ id: string }>('SELECT id FROM _migrations');
  const applied = new Set(rows.map((r) => r.id));
  const files = await listMigrationFiles();
  const newlyApplied: string[] = [];

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO _migrations (id) VALUES ($1)', [id]);
    });
    newlyApplied.push(id);
    logger.info({ migration: id }, 'applied migration');
  }
  return newlyApplied;
}

/** The latest applied migration id, or null. Used in backup manifests / health. */
export async function currentSchemaVersion(db: Database): Promise<string | null> {
  await ensureMigrationsTable(db);
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM _migrations ORDER BY id DESC LIMIT 1',
  );
  return rows[0]?.id ?? null;
}

// CLI entrypoint: `tsx src/db/migrate.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = getDb();
  runMigrations(db)
    .then((applied) => {
      logger.info({ applied }, applied.length ? 'migrations complete' : 'already up to date');
    })
    .catch((err) => {
      logger.error({ err }, 'migration failed');
      process.exitCode = 1;
    })
    .finally(closeDb);
}
