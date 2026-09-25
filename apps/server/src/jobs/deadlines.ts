import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { notifications, reservations } from '../db/schema/index.js';

/**
 * ARCH §9: the deadline jobs take their next `due_at` from Postgres, and only while the
 * database is already awake — at the end of a run, never from a timer (ADR-0016). The Worker
 * calls `hub.wake()` after any commit that creates or moves one of these deadlines, so the
 * alarm is never later than the work.
 */

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value !== '') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** `notifications.dispatch`: the earliest queued row that is not being waited on. */
export async function nextDispatchDueAt(db: Executor): Promise<Date | null> {
  const [row] = await db
    .select({ due: sql<string | null>`min(${notifications.nextAttemptAt})` })
    .from(notifications)
    .where(eq(notifications.status, 'queued'));
  return toDate(row?.due);
}

/**
 * `reservations.remind` (M4): the earliest moment a pending, un-reminded reservation enters
 * its reminder window, `expires_at − reservation_reminder_hours_before_expiry`.
 */
export async function nextReminderDueAt(
  db: Executor,
  reminderHoursBeforeExpiry: number,
): Promise<Date | null> {
  const seconds = reminderHoursBeforeExpiry * 3600;
  const [row] = await db
    .select({
      due: sql<string | null>`min(${reservations.expiresAt} - make_interval(secs => ${seconds}))`,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.status, 'pending'),
        isNull(reservations.remindedAt),
        isNotNull(reservations.expiresAt),
      ),
    );
  return toDate(row?.due);
}

/** `reservations.expire` (M4): the earliest `expires_at` of a pending reservation. */
export async function nextExpiryDueAt(db: Executor): Promise<Date | null> {
  const [row] = await db
    .select({ due: sql<string | null>`min(${reservations.expiresAt})` })
    .from(reservations)
    .where(and(eq(reservations.status, 'pending'), isNotNull(reservations.expiresAt)));
  return toDate(row?.due);
}
