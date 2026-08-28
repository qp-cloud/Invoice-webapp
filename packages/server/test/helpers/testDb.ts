import { createDb, type Database } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

/** A fresh, fully-migrated in-memory PGlite database for one test file. */
export async function makeTestDb(): Promise<Database> {
  const db = createDb({ dataDir: 'memory' });
  await runMigrations(db);
  return db;
}
