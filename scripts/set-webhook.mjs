#!/usr/bin/env node
/**
 * `pnpm bot:set-webhook` (ARCH §4, §15): register `PUBLIC_URL/telegram/webhook` with Telegram,
 * protected by `TELEGRAM_WEBHOOK_SECRET`, and publish the command menu in both languages
 * (ADR-0007). Idempotent: the deploy workflow runs it on every push to `main`, and a developer
 * runs it by hand after opening a tunnel.
 *
 * Telegram only accepts HTTPS webhooks, so `PUBLIC_URL` must be the Worker's URL or a tunnel,
 * never `http://localhost`. Stop `pnpm dev:telegram` first: a bot has either a webhook or
 * `getUpdates`, never both (ADR-0013).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotEnv, root } from './lib/wrangler.mjs';

loadDotEnv();

const token = process.env.BOT_TOKEN ?? '';
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
const publicUrl = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');

const problems = [];
if (!/^\d+:[\w-]{20,}$/.test(token)) problems.push('BOT_TOKEN is missing or not a bot token');
if (secret.length < 32) problems.push('TELEGRAM_WEBHOOK_SECRET must be at least 32 characters');
if (!/^https:\/\//.test(publicUrl)) problems.push('PUBLIC_URL must be an https:// URL');
if (problems.length > 0) {
  console.error(`bot:set-webhook: ${problems.join('; ')}.`);
  process.exit(1);
}

async function telegram(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(`${method}: ${payload.description ?? `HTTP ${response.status}`}`);
  }
  return payload.result;
}

const url = `${publicUrl}/telegram/webhook`;
await telegram('setWebhook', {
  url,
  secret_token: secret,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: false,
});

// The command menu comes from the shared catalogue, so it is never out of step with the bot.
const commands = ['start', 'help', 'sync', 'status'];
for (const language of ['ca', 'es']) {
  const messages = JSON.parse(
    readFileSync(join(root, `packages/shared/src/messages/${language}.json`), 'utf8'),
  );
  await telegram('setMyCommands', {
    commands: commands.map((command) => ({
      command,
      description: messages[`bot.command.${command}`],
    })),
    language_code: language,
  });
}

const info = await telegram('getWebhookInfo');
console.log(`bot:set-webhook: webhook is ${info.url} (${info.pending_update_count} pending)`);
if (info.last_error_message) {
  console.warn(`bot:set-webhook: Telegram's last delivery error: ${info.last_error_message}`);
}
