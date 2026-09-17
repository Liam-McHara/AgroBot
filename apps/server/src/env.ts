import { z } from 'zod';
import { CATALOG_SOURCES, LANGUAGES } from '@agrobot/shared';

/**
 * Every variable of ARCH §13, validated once at boot.
 *
 * Failures print the offending variables and exit; nothing here is ever logged by value
 * (ARCH §17).
 */

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const csvOfNumbers = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.string().regex(/^\d+$/, 'must be a Telegram id (digits only)')));

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Telegram (ADR-0013: this is 1.0's live token from M0 onwards).
  BOT_TOKEN: z.string().min(1, 'required'),
  BOT_USERNAME: z.string().min(1, 'required'),
  MINIAPP_SHORT_NAME: z.string().min(1, 'required'),
  BOT_MODE: z.enum(['webhook', 'polling']).default('webhook'),
  PUBLIC_URL: z.url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),

  DATABASE_URL: z.string().min(1, 'required'),

  ADMIN_TELEGRAM_IDS: csvOfNumbers,

  // Catalogue (ARCH §10). The source-specific variables are checked below.
  CATALOG_SOURCE: z.enum(CATALOG_SOURCES).default('sheets'),
  GOOGLE_SHEET_ID: z.string().optional(),
  GOOGLE_SHEET_RANGE: z.string().default('Productes!A:E'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  CATALOG_CSV_URL: z.url().optional(),

  DEFAULT_LOCALE: z.enum(LANGUAGES).default('ca'),
  TZ: z.string().default('Europe/Madrid'),
  PORT: z.coerce.number().int().positive().max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanish.default(false),
  SENTRY_DSN: z.string().optional(),

  /** Dev only, ignored in production (ARCH §4, ADR-0010). */
  DEV_AUTH_BYPASS_TELEGRAM_ID: z.string().regex(/^\d+$/).optional(),
});

const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.BOT_MODE === 'webhook') {
    if (!env.PUBLIC_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_URL'],
        message: 'required when BOT_MODE=webhook (the webhook is PUBLIC_URL/telegram/webhook)',
      });
    }
    if (!env.TELEGRAM_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_WEBHOOK_SECRET'],
        message: 'required when BOT_MODE=webhook',
      });
    }
  }

  if (env.CATALOG_SOURCE === 'sheets') {
    if (!env.GOOGLE_SHEET_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_SHEET_ID'],
        message: 'required when CATALOG_SOURCE=sheets',
      });
    }
    if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_SERVICE_ACCOUNT_JSON'],
        message: 'required when CATALOG_SOURCE=sheets (base64 of the service account key file)',
      });
    }
  } else if (!env.CATALOG_CSV_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['CATALOG_CSV_URL'],
      message: 'required when CATALOG_SOURCE=csv',
    });
  }

  if (env.NODE_ENV === 'production' && env.DEV_AUTH_BYPASS_TELEGRAM_ID) {
    ctx.addIssue({
      code: 'custom',
      path: ['DEV_AUTH_BYPASS_TELEGRAM_ID'],
      message: 'must not be set in production (ARCH §4)',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvError(
    result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  );
}

let cached: Env | undefined;

/** The validated environment. Parsed on first use so tests can build their own. */
export function env(): Env {
  cached ??= parseEnv();
  return cached;
}

export function isProduction(e: Env): boolean {
  return e.NODE_ENV === 'production';
}

/** ARCH §4: the bypass only exists outside production and only when configured. */
export function devAuthBypassId(e: Env): string | undefined {
  return isProduction(e) ? undefined : e.DEV_AUTH_BYPASS_TELEGRAM_ID;
}
