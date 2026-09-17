import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres database; running files in parallel would have
    // them truncate each other's rows mid-assertion.
    fileParallelism: false,
    setupFiles: ['test/setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
