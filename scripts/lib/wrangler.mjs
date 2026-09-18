/**
 * Shared by the scripts that run the Worker locally (ARCH §14, §15): `pnpm dev` and the e2e
 * suite both start `wrangler dev`, on different ports, with different variables, against
 * different databases.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../..', import.meta.url));
export const serverDir = join(root, 'apps/server');
export const miniAppDist = join(root, 'apps/miniapp/dist');
export const dotEnvPath = join(root, '.env');

/** Load the repository `.env` into `process.env` unless told not to. Returns whether it did. */
export function loadDotEnv() {
  if (process.env.SKIP_DOTENV === '1' || !existsSync(dotEnvPath)) return false;
  process.loadEnvFile(dotEnvPath);
  return true;
}

/** `wrangler.jsonc` insists the assets directory exists, even before the Mini App is built. */
export function ensureAssetsDirectory() {
  mkdirSync(miniAppDist, { recursive: true });
}

/** The shim pnpm links for the server's `wrangler` dev dependency. */
function wranglerBin() {
  const shim = join(
    serverDir,
    'node_modules/.bin',
    process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
  );
  if (!existsSync(shim)) {
    throw new Error(`wrangler is not installed at ${shim}; run \`pnpm install\`.`);
  }
  return shim;
}

/**
 * Start `wrangler dev` in `apps/server`. `vars` are passed with `--var`, `envFile` with
 * `--env-file`, and `databaseUrl` becomes the local Hyperdrive target. Returns the child.
 */
export function spawnWranglerDev({
  port,
  vars = {},
  envFile,
  databaseUrl,
  persistTo,
  extraArgs = [],
  stdio = 'inherit',
}) {
  ensureAssetsDirectory();
  const args = ['dev', '--port', String(port)];
  if (envFile) args.push('--env-file', envFile);
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && value !== '') args.push('--var', `${key}:${value}`);
  }
  if (persistTo) args.push('--persist-to', persistTo);
  args.push(...extraArgs);

  const env = {
    ...process.env,
    // No telemetry, no update nags, no login prompts: this is a local dev server.
    WRANGLER_SEND_METRICS: 'false',
    ...(databaseUrl
      ? { CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl }
      : {}),
  };
  return spawn(wranglerBin(), args, {
    cwd: serverDir,
    stdio,
    env,
    shell: process.platform === 'win32',
  });
}

/** Stop the child when this process is asked to stop, and exit with its code when it ends. */
export function tieLifetimeTo(child) {
  const forward = (signal) => () => {
    if (child.exitCode === null) child.kill(signal);
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}
