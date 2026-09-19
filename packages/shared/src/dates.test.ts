import { describe, expect, it } from 'vitest';
import { isDateBefore, isIsoDate, isoDateSchema, localDateString } from './dates.js';

describe('calendar dates on the farm (PRD US-3.4, §12)', () => {
  it('reads the Madrid date of an instant, across midnight and DST', () => {
    // 23:30 UTC on a summer night is already the next day in Madrid (UTC+2).
    expect(localDateString(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
    // 23:30 UTC in winter (UTC+1) too.
    expect(localDateString(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    // 22:30 UTC in winter is still the same day.
    expect(localDateString(new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31');
    expect(localDateString(new Date('2026-07-01T23:30:00Z'), 'UTC')).toBe('2026-07-01');
  });

  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2026-09-19')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('19/09/2026')).toBe(false);
    expect(isIsoDate('2026-9-19')).toBe(false);
    expect(isoDateSchema.safeParse('2026-09-19').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-09-31').success).toBe(false);
  });

  it('orders dates by comparing their text', () => {
    expect(isDateBefore('2026-09-18', '2026-09-19')).toBe(true);
    expect(isDateBefore('2026-09-19', '2026-09-19')).toBe(false);
    expect(isDateBefore('2026-10-01', '2026-09-30')).toBe(false);
  });
});
