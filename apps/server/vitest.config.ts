import { defineConfig } from 'vitest/config';

/**
 * Unit and integration tests on Node (ARCH §16). The hub's tests run inside workerd under
 * `vitest.workers.config.ts` and are excluded here.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.workers.test.ts'],
    environment: 'node',
    // Integration tests share one Postgres database; running files in parallel would have
    // them truncate each other's rows mid-assertion.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
