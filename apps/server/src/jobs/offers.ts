import { DAILY_JOB_TIMES, nextDailyOccurrence } from './schedule.js';
import type { JobDefinition } from './types.js';

/**
 * ARCH §9, PRD US-3.4: the two daily offer jobs, on the farm's clock. Both are plain calls
 * into `domain/offers`, which is where the rules and their tests live; here they only say when
 * they want to run again. Each is idempotent (status and timestamp guards), as alarms are
 * at-least-once (ADR-0017).
 */

/** Offers whose *available until* has passed leave the board at 00:05 Europe/Madrid. */
export const offersExpire: JobDefinition<'offers.expire'> = {
  name: 'offers.expire',
  async run(deps) {
    const result = await deps.offers.expire(deps.now());
    return { result, nextDueAt: nextDailyOccurrence(deps.now(), DAILY_JOB_TIMES['offers.expire']) };
  },
};

/** "Still available?" nudges, stale marks and weekly re-nudges at 09:00 Europe/Madrid. */
export const offersNudge: JobDefinition<'offers.nudge'> = {
  name: 'offers.nudge',
  async run(deps) {
    const result = await deps.offers.nudge(deps.now());
    return { result, nextDueAt: nextDailyOccurrence(deps.now(), DAILY_JOB_TIMES['offers.nudge']) };
  },
};
