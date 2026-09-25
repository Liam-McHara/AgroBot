import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../enums.js';
import { settingsSchema, updateSettingsSchema } from './settings.js';

describe('group settings (PRD US-7.1)', () => {
  it('accepts defaults, a one-minute expiry, immediate read-only and partial updates', () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(
      updateSettingsSchema.parse({
        reservation_expiry_hours: 1 / 60,
        thread_readonly_days_after_close: 0,
      }),
    ).toEqual({ reservation_expiry_hours: 1 / 60, thread_readonly_days_after_close: 0 });
  });
  it.each([
    {},
    { unknown: true },
    { notify_new_offer: 'false' },
    { reservation_expiry_hours: 0 },
    { reservation_expiry_hours: Infinity },
    { reservation_expiry_hours: 721 },
    { reservation_reminder_hours_before_expiry: -1 },
    { offer_nudge_days: 1.5 },
    { offer_stale_days_after_nudge: 0 },
    { thread_readonly_days_after_close: 366 },
  ])('rejects invalid settings %j', (input) => {
    expect(updateSettingsSchema.safeParse(input).success).toBe(false);
  });
});
