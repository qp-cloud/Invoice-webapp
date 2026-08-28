import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closeDb, getDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = getDb();

  const applied = await runMigrations(db);
  logger.info({ applied }, applied.length ? 'migrations applied on boot' : 'schema up to date');

  const app = await buildApp({ db });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(`listening on http://${config.HOST}:${config.PORT}`);
}

main().catch((err) => {
  logger.error({ err }, 'fatal boot error');
  process.exit(1);
});
