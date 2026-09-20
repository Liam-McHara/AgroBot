import { z } from 'zod';
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  MEMBER_ROLES,
  MEMBER_STATUSES,
} from '../enums.js';
import { languageSchema } from './common.js';
import { unreadCountsSchema } from './threads.js';

/** PRD §10: the group settings, as the Mini App and the jobs read them. */
export const settingsSchema = z.object({
  reservation_expiry_hours: z.number(),
  reservation_reminder_hours_before_expiry: z.number(),
  offer_nudge_days: z.number(),
  offer_stale_days_after_nudge: z.number(),
  thread_readonly_days_after_close: z.number(),
  notify_new_offer: z.boolean(),
});

/**
 * `GET /api/me` (ARCH §11): the identity the gate and the shell need, the member's language,
 * the settings subset the UI reads and the unread counts behind the Reservations badge
 * (PRD US-4.6); the badge is refreshed over the socket on `message.new` (ARCH §7).
 */
export const meSchema = z.object({
  id: z.uuid(),
  telegramId: z.string(),
  username: z.string().nullable(),
  displayName: z.string(),
  language: languageSchema,
  role: z.enum(MEMBER_ROLES),
  status: z.enum(MEMBER_STATUSES),
  settings: settingsSchema,
  unread: unreadCountsSchema,
});
export type Me = z.infer<typeof meSchema>;

/** PRD US-1.5: the display name is trimmed and 2–40 characters long. */
export const displayNameSchema = z
  .string()
  .trim()
  .min(DISPLAY_NAME_MIN_LENGTH)
  .max(DISPLAY_NAME_MAX_LENGTH);

/** `PATCH /api/me` (ARCH §11): either field, both optional, at least one. */
export const updateMeSchema = z
  .object({
    language: languageSchema.optional(),
    displayName: displayNameSchema.optional(),
  })
  .refine((body) => body.language !== undefined || body.displayName !== undefined, {
    message: 'nothing to update',
  });
export type UpdateMe = z.infer<typeof updateMeSchema>;
