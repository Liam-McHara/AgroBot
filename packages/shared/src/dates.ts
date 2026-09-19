import { z } from 'zod';
import { DISPLAY_TIMEZONE } from './enums.js';

/**
 * Calendar dates (PRD US-3.1 *available until*, US-3.4 expiry) are `YYYY-MM-DD` strings with
 * no time and no zone: "until Friday" means Friday on the farm. Comparisons are on the farm's
 * calendar too, so "today" is read in Europe/Madrid (PRD §12 i18n) wherever a date is judged.
 */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar date `instant` falls on in `timeZone`, as `YYYY-MM-DD`. */
export function localDateString(instant: Date, timeZone: string = DISPLAY_TIMEZONE): string {
  const parts: Record<string, string> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(instant)) {
    if (type !== 'literal') parts[type] = value;
  }
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

/** A real calendar date in `YYYY-MM-DD` form (no 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const isoDateSchema = z.string().refine(isIsoDate, { message: 'expected YYYY-MM-DD' });

/**
 * `YYYY-MM-DD` strings order like the dates they name, so `<` and `>=` on them compare days.
 * Named so a call site reads as what it decides.
 */
export function isDateBefore(date: string, other: string): boolean {
  return date < other;
}
