import { z } from 'zod';
import { MEMBER_ROLES, MEMBER_STATUSES } from '../enums.js';
import { languageSchema } from './common.js';

/**
 * `GET /api/me` (ARCH §11). M0 returns the identity the gate and the Mini App shell need;
 * M1 adds the settings subset and M5 the unread counts.
 */
export const meSchema = z.object({
  id: z.uuid(),
  telegramId: z.string(),
  username: z.string().nullable(),
  displayName: z.string(),
  language: languageSchema,
  role: z.enum(MEMBER_ROLES),
  status: z.enum(MEMBER_STATUSES),
});
export type Me = z.infer<typeof meSchema>;
