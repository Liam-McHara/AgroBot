#!/usr/bin/env node
/**
 * The Worker half of `pnpm dev` (ARCH §14): `wrangler dev --port 8080` on the real runtime,
 * with the repository `.env` as the Worker's variables and its `DATABASE_URL` as the local
 * Hyperdrive target. The Mini App runs on Vite next to it and proxies `/api` here;
 * `scripts/dev-telegram.mjs` feeds the local webhook.
 */
import { existsSync } from 'node:fs';
import { dotEnvPath, loadDotEnv, spawnWranglerDev, tieLifetimeTo } from './lib/wrangler.mjs';

const loaded = loadDotEnv();
if (!loaded) {
  console.warn(
    'dev: no .env at the repository root; the Worker will refuse to start without BOT_TOKEN,\n' +
      '     PUBLIC_URL and TELEGRAM_WEBHOOK_SECRET. Run `cp .env.example .env` and fill it in.',
  );
}

const port = Number(process.env.WORKER_PORT ?? 8080);
const child = spawnWranglerDev({
  port,
  envFile: existsSync(dotEnvPath) ? dotEnvPath : undefined,
  databaseUrl: process.env.DATABASE_URL,
});
tieLifetimeTo(child);
