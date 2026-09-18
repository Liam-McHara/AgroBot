import { describe, expect, it } from 'vitest';
import {
  CATALOG_SYNC_MINUTE,
  DAILY_JOB_TIMES,
  localParts,
  nextDailyOccurrence,
  nextHourlyOccurrence,
  offsetMinutes,
  zonedTimeToUtc,
} from './schedule.js';

/**
 * ARCH §9, ADR-0017: the periodic jobs run at a wall-clock time in Europe/Madrid. In 2026 the
 * clocks go forward on 29 March (01:59:59 CET → 03:00 CEST) and back on 25 October
 * (02:59:59 CEST → 02:00 CET), which is where the arithmetic has to be right.
 */
const utc = (iso: string) => new Date(iso);

describe('localParts and offsetMinutes', () => {
  it('reads the Madrid wall clock in summer and winter', () => {
    expect(localParts(utc('2026-07-01T10:00:00Z'))).toMatchObject({ hour: 12, minute: 0 });
    expect(localParts(utc('2026-01-15T10:00:00Z'))).toMatchObject({ hour: 11, minute: 0 });
    expect(offsetMinutes(utc('2026-07-01T10:00:00Z'))).toBe(120);
    expect(offsetMinutes(utc('2026-01-15T10:00:00Z'))).toBe(60);
  });

  it('crosses midnight into the next local day', () => {
    expect(localParts(utc('2026-07-01T23:30:00Z'))).toMatchObject({ month: 7, day: 2, hour: 1 });
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a Madrid wall-clock time to the instant it happens', () => {
    expect(zonedTimeToUtc({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }).toISOString()).toBe(
      '2026-07-01T07:00:00.000Z',
    );
    expect(
      zonedTimeToUtc({ year: 2026, month: 1, day: 15, hour: 0, minute: 5 }).toISOString(),
    ).toBe('2026-01-14T23:05:00.000Z');
  });

  it('shifts a skipped time forward by the gap', () => {
    // 02:30 does not exist on 29 March 2026 (02:00 CET jumps to 03:00 CEST): read it as 03:30.
    expect(
      zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }).toISOString(),
    ).toBe('2026-03-29T01:30:00.000Z');
  });

  it('resolves the repeated hour to its first occurrence', () => {
    // 02:30 happens twice on 25 October 2026; the first time is still CEST.
    expect(
      zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }).toISOString(),
    ).toBe('2026-10-25T00:30:00.000Z');
  });
});

describe('nextDailyOccurrence (offers.expire at 00:05, offers.nudge at 09:00)', () => {
  const expire = DAILY_JOB_TIMES['offers.expire'];
  const nudge = DAILY_JOB_TIMES['offers.nudge'];

  it('is later today when the time has not passed, tomorrow when it has', () => {
    expect(nextDailyOccurrence(utc('2026-07-01T05:00:00Z'), nudge).toISOString()).toBe(
      '2026-07-01T07:00:00.000Z',
    );
    expect(nextDailyOccurrence(utc('2026-07-01T07:00:00Z'), nudge).toISOString()).toBe(
      '2026-07-02T07:00:00.000Z',
    );
    expect(nextDailyOccurrence(utc('2026-07-01T07:00:01Z'), nudge).toISOString()).toBe(
      '2026-07-02T07:00:00.000Z',
    );
  });

  it('keeps 00:05 at 00:05 on the farm across the spring change (a 23-hour day)', () => {
    // 28 March, 13:00 UTC → next 00:05 is Sunday 29 March in CET, i.e. 23:05 UTC on the 28th.
    const first = nextDailyOccurrence(utc('2026-03-28T13:00:00Z'), expire);
    expect(first.toISOString()).toBe('2026-03-28T23:05:00.000Z');
    // The one after is Monday 30 March 00:05 in CEST, only 23 hours later.
    const second = nextDailyOccurrence(first, expire);
    expect(second.toISOString()).toBe('2026-03-29T22:05:00.000Z');
    expect((second.getTime() - first.getTime()) / 3_600_000).toBe(23);
    expect(localParts(second)).toMatchObject({ day: 30, hour: 0, minute: 5 });
  });

  it('keeps 09:00 at 09:00 on the farm across the autumn change (a 25-hour day)', () => {
    const first = nextDailyOccurrence(utc('2026-10-24T12:00:00Z'), nudge);
    expect(first.toISOString()).toBe('2026-10-25T08:00:00.000Z');
    expect(localParts(first)).toMatchObject({ day: 25, hour: 9, minute: 0 });
    const before = nextDailyOccurrence(utc('2026-10-23T12:00:00Z'), nudge);
    expect(before.toISOString()).toBe('2026-10-24T07:00:00.000Z');
    expect((first.getTime() - before.getTime()) / 3_600_000).toBe(25);
  });

  it('handles the last day of the month and of the year', () => {
    expect(nextDailyOccurrence(utc('2026-12-31T23:30:00Z'), expire).toISOString()).toBe(
      '2027-01-01T23:05:00.000Z',
    );
    expect(nextDailyOccurrence(utc('2026-02-28T23:30:00Z'), expire).toISOString()).toBe(
      '2026-03-01T23:05:00.000Z',
    );
  });
});

describe('nextHourlyOccurrence (catalog.sync at minute 7)', () => {
  it('is minute 7 of this hour or the next', () => {
    expect(
      nextHourlyOccurrence(utc('2026-03-29T00:59:30Z'), CATALOG_SYNC_MINUTE).toISOString(),
    ).toBe('2026-03-29T01:07:00.000Z');
    expect(
      nextHourlyOccurrence(utc('2026-03-29T01:07:00Z'), CATALOG_SYNC_MINUTE).toISOString(),
    ).toBe('2026-03-29T02:07:00.000Z');
    expect(
      nextHourlyOccurrence(utc('2026-12-31T23:08:00Z'), CATALOG_SYNC_MINUTE).toISOString(),
    ).toBe('2027-01-01T00:07:00.000Z');
  });
});
