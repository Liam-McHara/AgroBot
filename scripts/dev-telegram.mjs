#!/usr/bin/env node
/**
 * Telegram → local webhook forwarder (ARCH §14, ADR-0016).
 *
 * The Worker has no polling mode: production receives webhooks, and so does `wrangler dev`.
 * This script deletes the throwaway bot's webhook, long-polls `getUpdates` with `BOT_TOKEN`
 * and POSTs every update to the local webhook with the secret header, so the webhook handler
 * is the only bot code path, in development as in production.
 *
 * Never run it with the group's token (ADR-0013): a bot has either a webhook or `getUpdates`,
 * and this script takes the webhook away.
 */
import { loadDotEnv } from './lib/wrangler.mjs';

loadDotEnv();

const token = process.env.BOT_TOKEN ?? '';
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
const target = process.env.DEV_WEBHOOK_URL ?? 'http://localhost:8080/telegram/webhook';

if (!/^\d+:[\w-]{20,}$/.test(token)) {
  console.log(
    'dev:telegram: BOT_TOKEN is missing or still the placeholder, so no updates are forwarded.\n' +
      '              Create a throwaway bot with @BotFather and put its token in .env.',
  );
  process.exit(0);
}
if (secret.length < 32) {
  console.error('dev:telegram: TELEGRAM_WEBHOOK_SECRET must be set (32+ characters) in .env.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function telegram(method, body = {}, timeoutMs = 45_000) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`${method}: ${payload.description ?? `HTTP ${response.status}`}`);
  }
  return payload.result;
}

/** POST one update to the Worker; retried while `wrangler dev` is still starting. */
async function forward(update) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await fetch(target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': secret,
        },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return;
      console.warn(
        `dev:telegram: webhook answered ${response.status} for update ${update.update_id}`,
      );
      return;
    } catch (error) {
      if (attempt === 10) {
        console.warn(`dev:telegram: giving up on update ${update.update_id}: ${error.message}`);
        return;
      }
      await sleep(1000);
    }
  }
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
  });
}

await telegram('deleteWebhook', { drop_pending_updates: false });
const me = await telegram('getMe');
console.log(`dev:telegram: forwarding updates for @${me.username} to ${target}`);

let offset;
while (!stopping) {
  try {
    const updates = await telegram('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message', 'callback_query'],
    });
    for (const update of updates) {
      offset = update.update_id + 1;
      await forward(update);
    }
  } catch (error) {
    if (stopping) break;
    console.warn(`dev:telegram: ${error.message}; retrying in 3 s`);
    await sleep(3000);
  }
}
console.log('dev:telegram: stopped');
