#!/usr/bin/env node
/**
 * `pnpm deploy:worker` (ARCH §13, §15): deploy AgroBot to Cloudflare from environment
 * variables alone.
 *
 * Nothing deployment-specific lives in the repository, so any group of farmers can clone it and
 * run its own AgroBot without editing a tracked file. The script takes the committed
 * `apps/server/wrangler.jsonc` (what `wrangler dev` runs), replaces the name, the Hyperdrive id,
 * the placement and the vars with what the environment says, writes the result to the
 * git-ignored `apps/server/wrangler.deploy.jsonc`, runs `wrangler deploy` with it, and pushes
 * the secrets with `wrangler secret bulk`. Then `pnpm bot:set-webhook` points Telegram at it.
 *
 *   pnpm deploy:worker                         # CI: the variables are in the job's environment
 *   pnpm deploy:worker --env-file .env.staging # by hand, from a git-ignored file
 *   pnpm deploy:worker --dry-run               # build and validate, upload nothing
 *
 * Secrets never touch the generated file: they go to Cloudflare through stdin. The only vars
 * that reach the Worker are the ones listed here, so a development-only variable such as
 * DEV_AUTH_BYPASS_TELEGRAM_ID cannot leak into a deployment by sitting in the same file.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonc, serverDir, wranglerBin } from './lib/wrangler.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const envFileIndex = args.indexOf('--env-file');
if (envFileIndex !== -1) {
  const file = args[envFileIndex + 1];
  if (!file) {
    console.error('deploy:worker: --env-file needs a path.');
    process.exit(1);
  }
  process.loadEnvFile(resolve(file));
}

const value = (name) => {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
};

const problems = [];
const required = (name, check = () => true, hint = '') => {
  const raw = value(name);
  if (raw === undefined || !check(raw)) problems.push(`${name} ${hint || 'is required'}`.trim());
  return raw ?? '';
};

// ── What the deployment is ──────────────────────────────────────────────────────────────
const workerName = value('WORKER_NAME') ?? 'agrobot';
const hyperdriveId = required(
  'HYPERDRIVE_ID',
  (v) => /^[0-9a-f]{32}$/i.test(v),
  'must be the 32-character id from `wrangler hyperdrive create`',
);
const placementRegion = value('PLACEMENT_REGION');
if (!dryRun) {
  required('CLOUDFLARE_API_TOKEN');
  required('CLOUDFLARE_ACCOUNT_ID');
}

// ── Worker vars (ARCH §13): plain values, visible in the dashboard ──────────────────────
const catalogSource = value('CATALOG_SOURCE') ?? 'sheets';
const vars = {
  NODE_ENV: 'production',
  BOT_USERNAME: required('BOT_USERNAME'),
  MINIAPP_SHORT_NAME: value('MINIAPP_SHORT_NAME') ?? 'app',
  PUBLIC_URL: required('PUBLIC_URL', (v) => /^https:\/\//.test(v), 'must be an https:// URL'),
  ADMIN_TELEGRAM_IDS: value('ADMIN_TELEGRAM_IDS') ?? '',
  CATALOG_SOURCE: catalogSource,
  ...(catalogSource === 'sheets'
    ? {
        GOOGLE_SHEET_ID: required(
          'GOOGLE_SHEET_ID',
          () => true,
          'is required when CATALOG_SOURCE=sheets',
        ),
        GOOGLE_SHEET_RANGE: value('GOOGLE_SHEET_RANGE') ?? 'Productes!A:E',
      }
    : {
        CATALOG_CSV_URL: required(
          'CATALOG_CSV_URL',
          () => true,
          'is required when CATALOG_SOURCE=csv',
        ),
      }),
  DEFAULT_LOCALE: value('DEFAULT_LOCALE') ?? 'ca',
  TZ: value('TZ') ?? 'Europe/Madrid',
  LOG_LEVEL: value('LOG_LEVEL') ?? 'info',
  GIT_COMMIT: value('GIT_COMMIT') ?? value('GITHUB_SHA') ?? gitHead(),
};

// ── Worker secrets (ARCH §13, §17): uploaded through stdin, never written to disk ───────
const secrets = {
  BOT_TOKEN: required('BOT_TOKEN', (v) => /^\d+:[\w-]{20,}$/.test(v), 'must be a bot token'),
  TELEGRAM_WEBHOOK_SECRET: required(
    'TELEGRAM_WEBHOOK_SECRET',
    (v) => v.length >= 32,
    'must be at least 32 characters',
  ),
  ...(catalogSource === 'sheets'
    ? {
        GOOGLE_SERVICE_ACCOUNT_JSON: required(
          'GOOGLE_SERVICE_ACCOUNT_JSON',
          () => true,
          'is required when CATALOG_SOURCE=sheets (base64 of the key file)',
        ),
      }
    : {}),
  ...(value('SENTRY_DSN') ? { SENTRY_DSN: value('SENTRY_DSN') } : {}),
};

if (problems.length > 0) {
  console.error(`deploy:worker: cannot deploy:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

// ── The deploy configuration: the committed file with the deployment filled in ──────────
const base = readJsonc(join(serverDir, 'wrangler.jsonc'));
const config = {
  ...base,
  name: workerName,
  hyperdrive: [{ binding: 'HYPERDRIVE', id: hyperdriveId }],
  placement: placementRegion ? { mode: 'targeted', region: placementRegion } : base.placement,
  vars,
};
delete config.env;
const deployConfigName = 'wrangler.deploy.jsonc';
writeFileSync(
  join(serverDir, deployConfigName),
  `// Generated by scripts/deploy-worker.mjs from environment variables; do not edit.\n${JSON.stringify(config, null, 2)}\n`,
);
console.log(
  `deploy:worker: ${dryRun ? 'validating' : 'deploying'} Worker "${workerName}" ` +
    `(Hyperdrive ${hyperdriveId}, ${vars.PUBLIC_URL}, commit ${vars.GIT_COMMIT})`,
);

wrangler([
  'deploy',
  '--config',
  deployConfigName,
  ...(dryRun ? ['--dry-run', '--outdir', 'dist'] : []),
]);
if (!dryRun) {
  // A deploy never removes secrets; this sets or updates the ones the environment defines.
  wrangler(['secret', 'bulk', '--config', deployConfigName], JSON.stringify(secrets));
  console.log(`deploy:worker: ${Object.keys(secrets).length} secrets set on "${workerName}".`);
}

function wrangler(commandArgs, input) {
  const result = spawnSync(wranglerBin(), commandArgs, {
    cwd: serverDir,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    ...(input === undefined ? {} : { input }),
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function gitHead() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}
