import type { Language } from '@agrobot/shared';
import type { Database } from '../db/client.js';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import type { Member } from '../db/schema/index.js';

/** Everything the HTTP layer is handed at construction time. No module-level singletons. */
export interface AppDeps {
  readonly db: Database;
  readonly env: Env;
  readonly logger: Logger;
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
