#!/usr/bin/env node
/**
 * Boots the built server for the Playwright suite (ARCH §15): copies the Mini App build next
 * to the server, resets and seeds the e2e database, then starts `dist/index.js` with the dev
 * auth bypass enabled and a throwaway bot token. Telegram is unreachable here on purpose: the
 * bot's polling and the notification dispatcher log and retry, nothing else depends on them.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = join(root, 'apps/server');
const miniAppDist = join(root, 'apps/miniapp/dist');
const serverDist = join(serverDir, 'dist/index.js');

for (const [path, hint] of [
  [miniAppDist, 'pnpm --filter @agrobot/miniapp build'],
  [serverDist, 'pnpm --filter @agrobot/server build'],
]) {
  if (!existsSync(path)) {
    console.error(`e2e: missing ${path}; run \`${hint}\` (or \`pnpm build\`) first.`);
    process.exit(1);
  }
}

const publicDir = join(serverDir, 'public');
rmSync(publicDir, { recursive: true, force: true });
cpSync(miniAppDist, publicDir, { recursive: true });

const databaseUrl =
  process.env['E2E_DATABASE_URL'] ??
  process.env['TEST_DATABASE_URL'] ??
  'postgres://agrobot:agrobot@localhost:5432/agrobot_test';

Object.assign(process.env, {
  SKIP_DOTENV: '1',
  NODE_ENV: 'test',
  BOT_TOKEN: '123456:e2e-throwaway-token',
  BOT_USERNAME: 'AgroBotE2E',
  MINIAPP_SHORT_NAME: 'app',
  BOT_MODE: 'polling',
  DATABASE_URL: databaseUrl,
  ADMIN_TELEGRAM_IDS: process.env['E2E_ADMIN_TELEGRAM_ID'] ?? '900000100',
  CATALOG_SOURCE: 'csv',
  CATALOG_CSV_URL: 'https://example.test/catalog.csv',
  DEV_AUTH_BYPASS_TELEGRAM_ID: '900000001',
  PORT: process.env['E2E_PORT'] ?? '8081',
  LOG_LEVEL: process.env['E2E_LOG_LEVEL'] ?? 'warn',
});

// The server serves `./public` relative to its working directory (ARCH §15).
process.chdir(serverDir);

const { createDatabase } = await import(join(serverDir, 'dist/db/client.js'));
const { runMigrations } = await import(join(serverDir, 'dist/db/migrate.js'));
const { seed } = await import(join(serverDir, 'dist/db/seed.js'));

const handle = createDatabase(databaseUrl, { max: 1 });
await runMigrations(handle.db);
await handle.sql.unsafe(
  'truncate table notifications, thread_reads, messages, reservations, offers, products, ' +
    'catalog_syncs, member_invites, members restart identity cascade',
);
await seed(handle.db, { includeDevMembers: true });
await handle.close();
console.log(`e2e: database reset at ${databaseUrl.replace(/\/\/.*@/, '//…@')}`);

await import(serverDist);
