import packageJson from '../package.json' with { type: 'json' };
import type { Env } from './env.js';

/**
 * Version and build metadata, reported by `/health` and `/status` (ARCH §15).
 *
 * The version is this package's, bundled in at build time; the commit is the `GIT_COMMIT`
 * variable the deploy workflow passes to `wrangler deploy`, or `dev` when nobody did.
 */
export const APP_VERSION: string = packageJson.version;

export function gitCommit(env: Pick<Env, 'GIT_COMMIT'>): string {
  return env.GIT_COMMIT;
}
