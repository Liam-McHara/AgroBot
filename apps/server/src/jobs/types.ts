import type { Database } from '../db/client.js';
import type { CatalogSync } from '../db/schema/index.js';
import type { CatalogService } from '../domain/catalog/service.js';
import type { MembersService } from '../domain/members/service.js';
import type { OffersService } from '../domain/offers/service.js';
import type { HubPort } from '../domain/ports.js';
import type { Env } from '../env.js';
import type { TelegramSender } from '../integrations/telegram-api.js';
import type { Logger } from '../logger.js';
import type { DispatchReport } from './notifications-dispatch.js';

/**
 * ARCH §9: jobs are plain async functions the hub calls from its alarm (ADR-0017). Each one
 * says when it wants to run next, so the hub keeps exactly one `due_at` per job and one alarm.
 * Tests call the functions directly; the hub is the only caller in production.
 */

/** Whatever a job wants in its one-line log: counts, mostly. */
export interface JobReport {
  [key: string]: number | string | boolean | null | undefined;
}

/** What every job receives. Built once per alarm run; the database is closed after it. */
export interface JobDeps {
  db: Database;
  env: Env;
  logger: Logger;
  sender: TelegramSender;
  catalog: CatalogService;
  members: MembersService;
  offers: OffersService;
  /** The hub as the domain sees it; inside the hub it writes to the schedule directly. */
  hub: HubPort;
  now: () => Date;
}

/** Per job, what a caller may pass. `undefined` means "the scheduled run". */
export interface JobParams {
  'notifications.dispatch': undefined;
  'catalog.sync': { trigger: 'manual' | 'command'; actorId: string } | undefined;
}

export interface JobResults {
  'notifications.dispatch': DispatchReport;
  'catalog.sync': CatalogSync;
}

export type JobName = keyof JobParams & keyof JobResults;

export interface JobOutcome<N extends JobName> {
  result: JobResults[N];
  /** When this job should run again; `null` when nothing is due (deadline jobs). */
  nextDueAt: Date | null;
}

export interface JobDefinition<N extends JobName> {
  readonly name: N;
  run(deps: JobDeps, params: JobParams[N]): Promise<JobOutcome<N>>;
}

export type JobRegistry = { readonly [N in JobName]: JobDefinition<N> };

export function isJobName(value: unknown, registry: JobRegistry): value is JobName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(registry, value);
}
