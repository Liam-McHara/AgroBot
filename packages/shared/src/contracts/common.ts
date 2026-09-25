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
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export const languageSchema = z.enum(LANGUAGES);

/** `GET /health` (ARCH §1). A Worker has no uptime, so there is none to report. */
export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  commit: z.string(),
});
export type Health = z.infer<typeof healthSchema>;
