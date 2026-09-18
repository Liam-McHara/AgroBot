import { mkdirSync } from 'node:fs';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * The hub's tests run inside the Workers runtime (ARCH §16, ADR-0017): the Durable Object is
 * the real thing, with its SQLite storage, alarms and hibernating sockets, and each test gets
 * isolated storage. Jobs are swapped for a fake runner; they have their own tests against
 * Postgres.
 */
// `wrangler.jsonc` declares the Mini App build as the assets directory; the runtime insists
// it exists, and these tests never touch it.
mkdirSync(new URL('../miniapp/dist', import.meta.url), { recursive: true });

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['src/**/*.workers.test.ts'],
    testTimeout: 20_000,
  },
});
