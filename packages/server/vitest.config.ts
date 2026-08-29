import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@inventory/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', PGLITE_DATA_DIR: 'memory' },
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    // PGlite instances are per-test-file. Under TEST_PG=1 one real Postgres backs the
    // whole run with a fresh database per file.
    fileParallelism: true,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
