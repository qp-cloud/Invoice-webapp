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
   * If set, use a real PostgreSQL server instead of PGlite (production, or
   * concurrency tests). Not wired for query execution until Phase 8/prod hardening,
   * but the value is surfaced so code paths can branch.
   */
  DATABASE_URL: z.string().optional(),
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
