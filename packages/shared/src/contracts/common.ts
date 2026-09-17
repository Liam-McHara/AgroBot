import { z } from 'zod';
import { ERROR_CODES, LANGUAGES } from '../enums.js';

/**
 * ARCH §11: every error response is `{ error: { code, message, details? } }` with `message`
 * already localized in the member's language.
 */
export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export const languageSchema = z.enum(LANGUAGES);

export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  commit: z.string(),
  uptimeSeconds: z.number(),
});
export type Health = z.infer<typeof healthSchema>;
