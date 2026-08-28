import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@inventory/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // PGlite instances are per-test-file; run files in parallel but tests within a file serially.
    fileParallelism: true,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
