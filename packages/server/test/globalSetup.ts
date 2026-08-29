import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * When TEST_PG=1, boot ONE real PostgreSQL (via embedded-postgres) for the whole run and
 * write its base connection string to test/.pg-url. `makeTestDb()` then creates a fresh
 * database per test file against it. Without TEST_PG the suite uses in-memory PGlite and
 * this setup is a no-op.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pg: any;
let dataDir: string | undefined;
const urlFile = join(import.meta.dirname, '.pg-url');

export async function setup(): Promise<void> {
  if (!process.env.TEST_PG) return;

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  dataDir = mkdtempSync(join(tmpdir(), 'inv-pg-'));
  const port = 54329;

  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  writeFileSync(urlFile, `postgres://postgres:postgres@127.0.0.1:${port}/postgres`, 'utf8');
}

export async function teardown(): Promise<void> {
  if (pg) {
    await pg.stop();
    pg = undefined;
  }
  try {
    rmSync(urlFile, { force: true });
  } catch {
    /* ignore */
  }
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
}
