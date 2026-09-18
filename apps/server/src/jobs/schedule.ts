import { DISPLAY_TIMEZONE } from '@agrobot/shared';

/**
 * Next-occurrence math for the hub's periodic jobs (ARCH §9, ADR-0017).
 *
 * "00:05" means 00:05 on the farm, so the daily jobs are computed in Europe/Madrid with
 * `Intl.DateTimeFormat`, which is what makes the 23-hour and 25-hour days of a DST change
 * come out right. Everything returned is a UTC instant, which is all an alarm understands.
 */
export interface LocalTime {
  hour: number;
  minute: number;
}

export interface LocalDateTime extends LocalTime {
  year: number;
  /** 1–12, like a calendar and unlike `Date`. */
  month: number;
  day: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock reading of `date` in `timeZone`. */
export function localParts(date: Date, timeZone = DISPLAY_TIMEZONE): LocalDateTime {
  const parts: Record<string, number> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(date)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return {
    year: parts['year']!,
    month: parts['month']!,
    day: parts['day']!,
    hour: parts['hour']!,
    minute: parts['minute']!,
    second: parts['second']!,
  };
}

/** Minutes east of UTC that `timeZone` observes at `date` (+60 CET, +120 CEST). */
export function offsetMinutes(date: Date, timeZone = DISPLAY_TIMEZONE): number {
  const local = localParts(date, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * The instant at which `timeZone` reads `local`. A wall-clock time that exists twice (the
 * hour repeated when DST ends) resolves to its first occurrence; one that does not exist (the
 * hour skipped when DST starts) is shifted forward by the length of the gap, so 02:30 on the
 * spring day becomes 03:30. Neither case touches 00:05 or 09:00.
 */
export function zonedTimeToUtc(
  local: Omit<LocalDateTime, 'second'>,
  timeZone = DISPLAY_TIMEZONE,
): Date {
  const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
  const HALF_DAY = 12 * 60 * 60_000;
  // The offsets in force around that day: the two seasons' if a change falls near it.
  const offsets = new Set(
    [naive - HALF_DAY, naive, naive + HALF_DAY].map((at) => offsetMinutes(new Date(at), timeZone)),
  );
  const candidates = [...offsets].map((offset) => naive - offset * 60_000);
  const exact = candidates
    .filter((candidate) => {
      const parts = localParts(new Date(candidate), timeZone);
      return (
        parts.year === local.year &&
        parts.month === local.month &&
        parts.day === local.day &&
        parts.hour === local.hour &&
        parts.minute === local.minute
      );
    })
    .sort((a, b) => a - b);
  return new Date(exact[0] ?? Math.max(...candidates));
}

/** The next time the wall clock in `timeZone` reads `time`, strictly after `from`. */
export function nextDailyOccurrence(
  from: Date,
  time: LocalTime,
  timeZone = DISPLAY_TIMEZONE,
): Date {
  const today = localParts(from, timeZone);
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
    const candidate = zonedTimeToUtc(
      {
        year: day.getUTCFullYear(),
        month: day.getUTCMonth() + 1,
        day: day.getUTCDate(),
        hour: time.hour,
        minute: time.minute,
      },
      timeZone,
    );
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  throw new Error('no next occurrence within two days, which cannot happen');
}

/**
 * The next minute `minute` of an hour, strictly after `from`. Europe/Madrid is a whole number
 * of hours from UTC in both seasons, so "minute 7 of every hour" needs no time zone at all.
 */
export function nextHourlyOccurrence(from: Date, minute: number): Date {
  const candidate = new Date(from.getTime());
  candidate.setUTCMinutes(minute, 0, 0);
  if (candidate.getTime() <= from.getTime()) {
    candidate.setUTCHours(candidate.getUTCHours() + 1);
  }
  return candidate;
}

/** ARCH §9's table: when each periodic job runs, on the farm's clock. */
export const DAILY_JOB_TIMES = {
  'offers.expire': { hour: 0, minute: 5 },
  'offers.nudge': { hour: 9, minute: 0 },
} as const satisfies Record<string, LocalTime>;

/** ARCH §9: `catalog.sync` runs at minute 7 of every hour. */
export const CATALOG_SYNC_MINUTE = 7;
