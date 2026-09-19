#!/usr/bin/env node
/**
 * Boots the Worker for the Playwright suite (ARCH §15, §16): resets and seeds the e2e
 * database, serves a CSV catalogue fixture over local HTTP, then runs `wrangler dev` — the
 * real runtime, hub included — on `:8081` with the dev auth bypass, a throwaway bot token and
 * the local Hyperdrive pointed at the e2e database. Telegram is a local fake (below): the
 * hub's dispatcher delivers to it, and the specs read what would have reached each member.
 *
 * Requires a prior `pnpm build`: `wrangler.jsonc` serves the Mini App from `apps/miniapp/dist`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  miniAppDist,
  root,
  serverDir,
  spawnWranglerDev,
  tieLifetimeTo,
} from '../scripts/lib/wrangler.mjs';

const port = Number(process.env.E2E_PORT ?? 8081);

if (!existsSync(join(miniAppDist, 'index.html'))) {
  console.error(`e2e: missing ${miniAppDist}/index.html; run \`pnpm build\` first.`);
  process.exit(1);
}

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  'postgres://agrobot:agrobot@localhost:5432/agrobot_test';

// Migrations, truncation and seed through the server's own CLI (ARCH §16).
const reset = spawnSync(
  'pnpm',
  ['--filter', '@agrobot/server', 'exec', 'tsx', 'src/db/reset-test-database.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SKIP_DOTENV: '1', DATABASE_URL: databaseUrl },
  },
);
if (reset.status !== 0) process.exit(reset.status ?? 1);
console.log(`e2e: database reset at ${databaseUrl.replace(/\/\/.*@/, '//…@')}`);

// Exercise the real CSV adapter without depending on a network service or live secrets.
const catalogFixture = join(tmpdir(), `agrobot-e2e-catalog-${port}.csv`);
writeFileSync(catalogFixture, 'Producte,Unitat,Preu\nOus,dotzena,3.10\n');
const catalogServer = createServer((_request, response) => {
  response.setHeader('content-type', 'text/csv');
  response.end(readFileSync(catalogFixture, 'utf8'));
});
await new Promise((resolve) => catalogServer.listen(0, '127.0.0.1', resolve));
const catalogPort = catalogServer.address().port;

// A fake Telegram Bot API (ARCH §16): the hub's dispatcher sends notifications here instead
// of failing against the real one, and the specs read what arrived at `GET /messages`.
// The bot's own calls (`sendMessage`, `editMessageText`, …) all answer as if they succeeded.
const telegramPort = Number(process.env.E2E_TELEGRAM_PORT ?? 8089);
const telegramMessages = [];
const telegramServer = createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${telegramPort}`);
  if (url.pathname === '/messages') {
    if (request.method === 'DELETE') telegramMessages.length = 0;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(telegramMessages));
    return;
  }
  const method = url.pathname.split('/').at(-1);
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    let payload = {};
    try {
      payload = body ? JSON.parse(body) : {};
    } catch {
      /* multipart or empty: nothing the specs read */
    }
    if (method === 'sendMessage') telegramMessages.push(payload);
    const messageId = telegramMessages.length;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        ok: true,
        result: {
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: payload.chat_id ?? 0, type: 'private' },
          text: payload.text ?? '',
        },
      }),
    );
  });
});
await new Promise((resolve) => telegramServer.listen(telegramPort, '127.0.0.1', resolve));

// A fresh hub every run: its schedule, tickets and counters live in wrangler's local state.
const persistTo = mkdtempSync(join(tmpdir(), 'agrobot-e2e-state-'));
process.on('exit', () => {
  rmSync(persistTo, { recursive: true, force: true });
  catalogServer.close();
  telegramServer.close();
});

const child = spawnWranglerDev({
  port,
  databaseUrl,
  persistTo,
  vars: {
    NODE_ENV: 'test',
    BOT_TOKEN: '123456:e2e-throwaway-token-not-a-real-one',
    BOT_USERNAME: 'AgroBotE2E',
    MINIAPP_SHORT_NAME: 'app',
    PUBLIC_URL: `http://localhost:${port}`,
    TELEGRAM_WEBHOOK_SECRET: 'e2e-webhook-secret-with-at-least-32-characters',
    ADMIN_TELEGRAM_IDS: process.env.E2E_ADMIN_TELEGRAM_ID ?? '900000100',
    CATALOG_SOURCE: 'csv',
    CATALOG_CSV_URL: `http://127.0.0.1:${catalogPort}/`,
    DEV_AUTH_BYPASS_TELEGRAM_ID: '900000001',
    TELEGRAM_API_ROOT: `http://127.0.0.1:${telegramPort}`,
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  },
  extraArgs: ['--show-interactive-dev-session', 'false'],
});
console.log(`e2e: wrangler dev starting on :${port} (project ${serverDir})`);
tieLifetimeTo(child);
