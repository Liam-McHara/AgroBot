import { pino } from 'pino';
import { parseEnv } from '../../src/env.js';
import { createApp } from '../../src/http/app.js';
import type { AppDeps } from '../../src/http/context.js';
import type { DatabaseHandle } from '../../src/db/client.js';
import { createMembersService } from '../../src/domain/members/service.js';
import { TEST_DATABASE_URL } from './database.js';

export const TEST_BOT_TOKEN = '123456:test-token-for-integration-tests';

export function testDeps(database: DatabaseHandle, overrides: NodeJS.ProcessEnv = {}): AppDeps {
  const env = parseEnv({
    BOT_TOKEN: TEST_BOT_TOKEN,
    BOT_USERNAME: 'AgroBotTest',
    MINIAPP_SHORT_NAME: 'app',
    BOT_MODE: 'polling',
    DATABASE_URL: TEST_DATABASE_URL,
    CATALOG_SOURCE: 'csv',
    CATALOG_CSV_URL: 'https://example.test/catalog.csv',
    ...overrides,
  });
  return {
    db: database.db,
    env,
    logger: pino({ level: 'silent' }),
    members: createMembersService({ db: database.db, adminTelegramIds: env.ADMIN_TELEGRAM_IDS }),
  };
}

export function testApp(database: DatabaseHandle, overrides: NodeJS.ProcessEnv = {}) {
  return createApp(testDeps(database, overrides));
}
