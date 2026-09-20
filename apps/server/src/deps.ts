import { Api } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { createDatabase, type Database, type DatabaseHandle } from './db/client.js';
import { createCatalogService, type CatalogService } from './domain/catalog/service.js';
import { createMembersService, type MembersService } from './domain/members/service.js';
import { createOffersService, type OffersService } from './domain/offers/service.js';
import {
  createReservationsService,
  type ReservationsService,
} from './domain/reservations/service.js';
import { createThreadsService, type ThreadsService } from './domain/threads/service.js';
import type { HubPort } from './domain/ports.js';
import { telegramClientOptions, type Bindings, type Env } from './env.js';
import { createCatalogSource } from './integrations/catalog-source.js';
import { grammySender, type TelegramSender } from './integrations/telegram-api.js';
import type { JobDeps } from './jobs/types.js';
import type { Logger } from './logger.js';

/**
 * How the pieces are assembled, shared by the Worker's `fetch` and the hub's alarm (ARCH §1).
 * Everything is built per invocation and nothing is a singleton: an isolate may serve one
 * request or a thousand, and a Durable Object may be evicted between two alarms.
 */

/** Telegram answers in seconds or not at all; a hung call must not eat an alarm's budget. */
const TELEGRAM_TIMEOUT_SECONDS = 20;

/**
 * ARCH §3: one postgres.js client per invocation over Hyperdrive, which holds the real pool.
 * Five connections is the Workers cap on concurrent outbound connections; the type round trip
 * is skipped because the schema only uses types the driver already knows.
 */
export function openDatabase(bindings: Pick<Bindings, 'HYPERDRIVE'>): DatabaseHandle {
  return createDatabase(bindings.HYPERDRIVE.connectionString, { max: 5, fetchTypes: false });
}

export interface Services {
  members: MembersService;
  catalog: CatalogService;
  offers: OffersService;
  reservations: ReservationsService;
  threads: ThreadsService;
}

export function createServices(input: { db: Database; env: Env; hub: HubPort }): Services {
  return {
    members: createMembersService({
      db: input.db,
      adminTelegramIds: input.env.ADMIN_TELEGRAM_IDS,
      hub: input.hub,
    }),
    catalog: createCatalogService({
      db: input.db,
      source: createCatalogSource(input.env),
      hub: input.hub,
    }),
    offers: createOffersService({ db: input.db, hub: input.hub }),
    reservations: createReservationsService({ db: input.db, hub: input.hub }),
    threads: createThreadsService({ db: input.db, hub: input.hub }),
  };
}

/** The grammY API client the hub sends notifications through, with the 429 auto-retry. */
export function createTelegramSender(
  env: Pick<Env, 'BOT_TOKEN' | 'TELEGRAM_API_ROOT' | 'NODE_ENV'>,
): TelegramSender {
  const api = new Api(env.BOT_TOKEN, telegramClientOptions(env, TELEGRAM_TIMEOUT_SECONDS));
  api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
  return grammySender(api);
}

export function createJobDeps(input: {
  db: Database;
  env: Env;
  logger: Logger;
  hub: HubPort;
  now?: () => Date;
}): JobDeps {
  const services = createServices(input);
  return {
    db: input.db,
    env: input.env,
    logger: input.logger,
    hub: input.hub,
    sender: createTelegramSender(input.env),
    now: input.now ?? (() => new Date()),
    ...services,
  };
}
