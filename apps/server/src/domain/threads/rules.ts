import { MESSAGE_PREVIEW_LENGTH, type ReservationStatus } from '@agrobot/shared';

/**
 * The pure part of threads (PRD US-5.1; ARCH §8 step 3). No database, no clock: these decide,
 * `service.ts` applies them inside transactions.
 */

const DAY_MS = 86_400_000;

/** ARCH §8 step 3: the N9 throttle key, one per (thread, recipient). */
export function chatDedupeKey(reservationId: string, memberId: string): string {
  return `chat:${reservationId}:${memberId}`;
}

export interface ThreadWindow {
  writable: boolean;
  /** When writing stops, once the reservation has closed; `null` while it is active. */
  writableUntil: Date | null;
}

/**
 * PRD US-5.1: the thread is writable while the reservation is active (pending, confirmed) and
 * for `thread_readonly_days_after_close` days after it closes; then read-only.
 */
export function threadWindowOf(
  reservation: { status: ReservationStatus; closedAt: Date | null },
  readonlyDaysAfterClose: number,
  at: Date,
): ThreadWindow {
  if (reservation.status === 'pending' || reservation.status === 'confirmed') {
    return { writable: true, writableUntil: null };
  }
  if (reservation.closedAt === null) return { writable: false, writableUntil: null };
  const writableUntil = new Date(reservation.closedAt.getTime() + readonlyDaysAfterClose * DAY_MS);
  return { writable: at.getTime() < writableUntil.getTime(), writableUntil };
}

/** PRD N9: the message that opened the burst, on one line, cut to `MESSAGE_PREVIEW_LENGTH`. */
export function previewOf(body: string): string {
  const characters = Array.from(body.replace(/\s+/g, ' ').trim());
  if (characters.length <= MESSAGE_PREVIEW_LENGTH) return characters.join('');
  return `${characters
    .slice(0, MESSAGE_PREVIEW_LENGTH - 1)
    .join('')
    .trimEnd()}…`;
}
