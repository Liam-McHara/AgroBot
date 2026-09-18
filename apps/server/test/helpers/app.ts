import type { RealtimeEvent } from '@agrobot/shared';
import { parseEnv } from '../../src/env.js';
import { createApp } from '../../src/http/app.js';
import type { AppDeps } from '../../src/http/context.js';
import type { DatabaseHandle } from '../../src/db/client.js';
import { createCatalogService } from '../../src/domain/catalog/service.js';
import type { CatalogSource } from '../../src/domain/catalog/source.js';
import { createMembersService } from '../../src/domain/members/service.js';
import { createCatalogSource } from '../../src/integrations/catalog-source.js';
import type { SendMessageInput, TelegramSender } from '../../src/integrations/telegram-api.js';
import { jobs } from '../../src/jobs/index.js';
import type { JobDeps, JobName, JobParams, JobResults } from '../../src/jobs/types.js';
import { silentLogger } from '../../src/logger.js';
import type { Hub } from '../../src/realtime/port.js';

export const TEST_BOT_TOKEN = '123456:test-token-for-integration-tests';
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-with-at-least-32-characters';

export type EnvOverrides = Readonly<Record<string, string | undefined>>;

/**
 * The hub as the integration tests see it (ARCH §16): no Durable Object, so `runJob` runs the
 * job function in-process against the test database, and `wake`/`publish` are recorded so a
 * test can assert that a commit told the hub.
 */
export interface FakeHub extends Hub {
  wakes: number;
  published: Array<{ memberIds: string[]; event: RealtimeEvent }>;
  /** What the in-process dispatcher would have sent to Telegram. */
  sent: SendMessageInput[];
}

export function createFakeHub(jobDeps: () => JobDeps): FakeHub {
  const hub: FakeHub = {
    wakes: 0,
    published: [],
    sent: [],
    wake() {
      hub.wakes += 1;
    },
    publish(memberIds, event) {
      hub.published.push({ memberIds: [...memberIds], event });
    },
    async runJob<N extends JobName>(name: N, params: JobParams[N]): Promise<JobResults[N]> {
      const outcome = await jobs[name].run(jobDeps(), params);
      return outcome.result;
    },
    async issueTicket() {
      return 'ticket-for-tests';
    },
    async upgrade() {
      return new Response('no hub in integration tests', { status: 501 });
    },
  };
  return hub;
}

export interface TestDepsOptions {
  /** A catalogue source other than the CSV url of the environment. */
  source?: CatalogSource;
  /** A Telegram double for the dispatcher; by default sends are only recorded on the hub. */
  sender?: TelegramSender;
}

export type TestDeps = AppDeps & { hub: FakeHub; jobDeps: JobDeps };

export function testDeps(
  database: DatabaseHandle,
  overrides: EnvOverrides = {},
  options: TestDepsOptions = {},
): TestDeps {
  const env = parseEnv({
    BOT_TOKEN: TEST_BOT_TOKEN,
    BOT_USERNAME: 'AgroBotTest',
    MINIAPP_SHORT_NAME: 'app',
    PUBLIC_URL: 'http://localhost:8080',
    TELEGRAM_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    CATALOG_SOURCE: 'csv',
    CATALOG_CSV_URL: 'https://example.test/catalog.csv',
    ...overrides,
  });
  const hub = createFakeHub(() => jobDeps);
  const members = createMembersService({
    db: database.db,
    adminTelegramIds: env.ADMIN_TELEGRAM_IDS,
    hub,
  });
  const catalog = createCatalogService({
    db: database.db,
    source: options.source ?? createCatalogSource(env),
    hub,
  });
  const deps: AppDeps = { db: database.db, env, logger: silentLogger, members, catalog, hub };
  const sender: TelegramSender = options.sender ?? {
    async sendMessage(input) {
      hub.sent.push(input);
      return { messageId: hub.sent.length };
    },
  };
  const jobDeps: JobDeps = { ...deps, sender, now: () => new Date() };
  return { ...deps, hub, jobDeps };
}

export function testApp(database: DatabaseHandle, overrides: EnvOverrides = {}) {
  return createApp(testDeps(database, overrides));
}
