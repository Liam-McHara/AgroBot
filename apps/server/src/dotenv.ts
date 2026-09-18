import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Load the repository's `.env` if there is one, so `pnpm dev`, `pnpm db:migrate` and
 * `pnpm db:seed` behave the same whether they are run from the root or from `apps/server`.
 *
 * Real deployments get variables from the Worker's vars and secrets (ARCH §13, ADR-0016) and
 * have no `.env`; this is a no-op there.
 */
export function loadDotEnv(): void {
  if (process.env['SKIP_DOTENV'] === '1') return;
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}
