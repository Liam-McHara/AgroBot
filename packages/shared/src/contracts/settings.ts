import { z } from 'zod';

/** PRD US-7.1: one schema for persistence, API and the admin form. */
export const settingsSchema = z.strictObject({
  reservation_expiry_hours: z
    .number()
    .min(1 / 60)
    .max(720),
  reservation_reminder_hours_before_expiry: z.number().min(0).max(720),
  offer_nudge_days: z.number().int().min(1).max(365),
  offer_stale_days_after_nudge: z.number().int().min(1).max(365),
  thread_readonly_days_after_close: z.number().int().min(0).max(365),
  notify_new_offer: z.boolean(),
});

export const updateSettingsSchema = settingsSchema
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'nothing to update',
  });
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
