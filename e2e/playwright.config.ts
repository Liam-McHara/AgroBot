import { defineConfig, devices } from '@playwright/test';

/**
 * ARCH §15/§16: Playwright against `wrangler dev` — the real runtime, hub included — serving
 * the built Mini App, with the dev auth bypass and a freshly seeded database. Run `pnpm build`
 * first; `start-server.mjs` resets the database and boots the Worker on `:8081`.
 *
 * One worker: the scenarios share one database, one hub and one bot identity.
 */
export const E2E_PORT = Number(process.env['E2E_PORT'] ?? 8081);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Telegram ids the scenarios sign in as through the dev bypass (ARCH §4). */
export const IDS = {
  admin: '900000100',
  applicant: '900000200',
} as const;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
  },
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: `${E2E_BASE_URL}/health`,
    cwd: '..',
    // wrangler bundles the Worker and starts workerd before /health answers.
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      E2E_PORT: String(E2E_PORT),
      E2E_ADMIN_TELEGRAM_ID: IDS.admin,
    },
  },
});
