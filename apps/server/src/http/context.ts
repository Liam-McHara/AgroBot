import type { CatalogService } from '../domain/catalog/service.js';
import type { Language } from '@agrobot/shared';
import type { Database } from '../db/client.js';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import type { Member } from '../db/schema/index.js';
import type { MembersService } from '../domain/members/service.js';
import type { OffersService } from '../domain/offers/service.js';
import type { ReservationsService } from '../domain/reservations/service.js';
import type { ThreadsService } from '../domain/threads/service.js';
import type { Hub } from '../realtime/port.js';
import type { ErrorReporter } from '../observability.js';

/**
 * Everything the HTTP layer and the bot are handed at construction time. No singletons: the
 * Worker builds one of these per request (ARCH §3), the tests build one per suite.
 */
export interface AppDeps {
  readonly db: Database;
  readonly env: Env;
  readonly logger: Logger;
  readonly members: MembersService;
  readonly catalog: CatalogService;
  readonly offers: OffersService;
  readonly reservations: ReservationsService;
  readonly threads: ThreadsService;
  /** The one hub (ADR-0017): jobs on demand, socket tickets, and the upgrade hand-off. */
  readonly hub: Hub;
  readonly reportError?: ErrorReporter;
}

export interface AppVariables {
  requestId: string;
  logger: Logger;
  /** The language to answer in: the member's if we know them, else Telegram's, else default. */
  language: Language;
  member?: Member;
  reportError?: ErrorReporter;
}

export interface AppContext {
  Variables: AppVariables;
}
