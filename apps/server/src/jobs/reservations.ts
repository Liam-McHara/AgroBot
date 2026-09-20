import { loadSettings } from '../domain/settings/service.js';
import { nextExpiryDueAt, nextReminderDueAt } from './deadlines.js';
import type { JobDefinition } from './types.js';

/**
 * ARCH §9, PRD US-4.5: the two reservation deadline jobs. Both are plain calls into
 * `domain/reservations`, where the rules and their tests live; here they only say when they
 * want to run again, which they read from Postgres while it is already awake (ADR-0016): the
 * earliest reminder window or the earliest `expires_at` still pending. The Worker calls
 * `hub.wake()` after every reservation transaction, so the hub asks again whenever a deadline
 * may have moved. Each is idempotent (`reminded_at`, the status guard), as alarms are
 * at-least-once (ADR-0017).
 */

/** N7 to the producer once a pending reservation enters its reminder window. */
export const reservationsRemind: JobDefinition<'reservations.remind'> = {
  name: 'reservations.remind',
  async run(deps) {
    const result = await deps.reservations.remind(deps.now());
    const settings = await loadSettings(deps.db);
    return {
      result,
      nextDueAt: await nextReminderDueAt(
        deps.db,
        settings.reservation_reminder_hours_before_expiry,
      ),
    };
  },
};

/** Pending reservations past `expires_at` expire, release their quantity and tell both parties. */
export const reservationsExpire: JobDefinition<'reservations.expire'> = {
  name: 'reservations.expire',
  async run(deps) {
    const result = await deps.reservations.expire(deps.now());
    return { result, nextDueAt: await nextExpiryDueAt(deps.db) };
  },
};
