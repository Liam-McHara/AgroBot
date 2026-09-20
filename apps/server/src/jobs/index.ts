import { notFound } from '../errors.js';
import { nextDispatchDueAt } from './deadlines.js';
import { DISPATCH_BATCH_SIZE, dispatchNotifications } from './notifications-dispatch.js';
import { offersExpire, offersNudge } from './offers.js';
import { reservationsExpire, reservationsRemind } from './reservations.js';
import { CATALOG_SYNC_MINUTE, nextHourlyOccurrence } from './schedule.js';
import type { JobName, JobRegistry } from './types.js';

/**
 * ARCH §9's job table. Adding a job is one more entry here and nothing else changes in the
 * hub; the deadline jobs are also named in `DEADLINE_JOBS`, which `hub.wake()` brings forward.
 */
export const jobs: JobRegistry = {
  /**
   * ARCH §8 step 2: drain the outbox in batches of 20. A full batch means more may be waiting,
   * so the job asks to run again at once; otherwise the next due is the earliest retry.
   */
  'notifications.dispatch': {
    name: 'notifications.dispatch',
    async run(deps) {
      const startedAt = deps.now();
      const report = await dispatchNotifications({
        db: deps.db,
        env: deps.env,
        sender: deps.sender,
        logger: deps.logger,
        now: deps.now,
      });
      const processed = report.sent + report.retried + report.failed;
      const nextDueAt =
        processed >= DISPATCH_BATCH_SIZE ? startedAt : await nextDispatchDueAt(deps.db);
      return { result: report, nextDueAt };
    },
  },

  /**
   * ARCH §10: hourly at minute 7, and on demand from `/sync` or *Sync now*, in which case the
   * actor is re-read and re-authorized by the domain before anything is fetched or applied.
   */
  'catalog.sync': {
    name: 'catalog.sync',
    async run(deps, params) {
      let result;
      if (params) {
        const actor = await deps.members.getById(params.actorId);
        if (!actor) throw notFound({ memberId: params.actorId });
        result = await deps.catalog.sync({ trigger: params.trigger, actor });
      } else {
        result = await deps.catalog.sync({ trigger: 'schedule' });
      }
      return { result, nextDueAt: nextHourlyOccurrence(deps.now(), CATALOG_SYNC_MINUTE) };
    },
  },

  /** PRD US-3.4, ARCH §9: the daily offer jobs, at 00:05 and 09:00 on the farm. */
  'offers.expire': offersExpire,
  'offers.nudge': offersNudge,

  /** PRD US-4.5, ARCH §9: the reservation deadline jobs, due when Postgres says so. */
  'reservations.remind': reservationsRemind,
  'reservations.expire': reservationsExpire,
};

export const JOB_NAMES = Object.keys(jobs) as readonly JobName[];

/**
 * ARCH §9: the jobs whose next `due_at` comes from Postgres. `hub.wake()` makes them due now,
 * so a commit that created or moved a deadline (a notification, a reservation) is followed by
 * a run that finds the work or learns when it is due; nothing polls in between (ADR-0016).
 */
export const DEADLINE_JOBS = [
  'notifications.dispatch',
  'reservations.remind',
  'reservations.expire',
] as const satisfies readonly JobName[];

export type { JobDeps, JobName, JobOutcome, JobParams, JobRegistry, JobResults } from './types.js';
