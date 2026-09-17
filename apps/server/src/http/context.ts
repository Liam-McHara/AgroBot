import type { CatalogService } from '../domain/catalog/service.js';
import type { Language } from '@agrobot/shared';
import type { Database } from '../db/client.js';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import type { Member } from '../db/schema/index.js';
import type { MembersService } from '../domain/members/service.js';

/** Everything the HTTP layer and the bot are handed at construction time. No singletons. */
export interface AppDeps {
  readonly db: Database;
  readonly env: Env;
  readonly logger: Logger;
  readonly members: MembersService;
  readonly catalog: CatalogService;
}

export interface AppVariables {
  requestId: string;
  logger: Logger;
  /** The language to answer in: the member's if we know them, else Telegram's, else default. */
  language: Language;
  member?: Member;
}

export interface AppContext {
  Variables: AppVariables;
}
