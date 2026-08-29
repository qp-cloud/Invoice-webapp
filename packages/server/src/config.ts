import { z } from 'zod';

/**
 * Runtime configuration. Business/domain settings live in the DB `settings` table
 * (DATABASE.md §2.1); this is only process/environment wiring.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /**
   * Where PGlite persists. Empty / "memory" => ephemeral in-memory (tests, quick dev).
   * A path => durable local database directory.
   */
  PGLITE_DATA_DIR: z.string().default('memory'),
  /**
   * If set, use a real PostgreSQL server (via the node-postgres adapter) instead of
   * PGlite — production, or the `TEST_PG=1` concurrency/stress runs.
   */
  DATABASE_URL: z.string().optional(),
  /** Directory for local backup artifacts (spec §16). */
  BACKUP_DIR: z.string().default('./backups'),
  /**
   * Default backup passphrase. A request may override it per call; it is never stored
   * in the DB and is redacted from logs (spec §16.5). Min length enforced at use.
   */
  BACKUP_PASSPHRASE: z.string().optional(),
  /**
   * Owner unlock PIN (spec §16.5). If set, every `/api` route except health + auth
   * requires an unlock cookie. Unset = open (local single-user default).
   */
  APP_PIN: z.string().optional(),
  /** Optional stable secret for the unlock cookie HMAC; defaults to the PIN hash. */
  APP_SESSION_SECRET: z.string().optional(),
  /** If set, the server also serves the built web app (SPA) from this directory. */
  WEB_DIST_DIR: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Fail fast and loud — misconfiguration must never boot silently (spec §37).
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: force a fresh parse (e.g. after mutating process.env in a test). */
export function resetConfigCache(): void {
  cached = undefined;
}
