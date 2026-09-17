import { readFileSync } from 'node:fs';

/**
 * Version and build metadata, reported by `/health` and (from M2) by `/status` (ARCH §15).
 *
 * The version is this package's, read from the `package.json` that sits next to the running
 * code: `apps/server/package.json` from the sources, `/app/package.json` in the image. The
 * commit is baked in at build time. Both can be overridden by the environment.
 */
function packageVersion(): string {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const version = (manifest as { version?: unknown }).version;
    return typeof version === 'string' ? version : '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

export const APP_VERSION = process.env['APP_VERSION'] ?? packageVersion();
export const GIT_COMMIT = process.env['GIT_COMMIT'] ?? 'dev';
