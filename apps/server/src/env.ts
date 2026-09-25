import { z } from 'zod';
import { CATALOG_SOURCES, LANGUAGES } from '@agrobot/shared';
import type { AgroBotHub } from './realtime/hub.js';

/**
 * Every variable of ARCH §13, validated at the start of every invocation.
 *
 * The Worker hands `fetch` a bindings object that mixes plain string vars, secrets and the
 * bindings themselves (Hyperdrive, the hub, the static assets); `parseEnv` validates the
 * variables and ignores the rest. Failures list the offending variables by name; nothing here
 * is ever logged by value (ARCH §17).
 */

/** What Cloudflare passes as `env` (ARCH §13): variables, secrets and bindings together. */
export interface Bindings {
  /** ARCH §3: Neon's pooled connection string, reached through Hyperdrive (ADR-0016). */
  HYPERDRIVE: Hyperdrive;
  /** ARCH §7, §9: the one `AgroBotHub` instance (ADR-0017). */
  HUB: DurableObjectNamespace<AgroBotHub>;
  /** The Mini App build, served by Static Assets (ARCH §3). */
  ASSETS?: Fetcher;
  [variable: string]: unknown;
}

export type EnvSource = Readonly<Record<string, unknown>>;

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
  /** The webhook is `PUBLIC_URL/telegram/webhook`; also the accepted socket `Origin`. */
  PUBLIC_URL: z.url({ error: 'required (the Worker URL, or the tunnel in development)' }),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(32, 'must be at least 32 characters'),

  ADMIN_TELEGRAM_IDS: csvOfNumbers,

  // Catalogue (ARCH §10). The source-specific variables are checked below.
  CATALOG_SOURCE: z.enum(CATALOG_SOURCES).default('sheets'),
  GOOGLE_SHEET_ID: z.string().optional(),
  GOOGLE_SHEET_RANGE: z.string().default('Productes!A:E'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  CATALOG_CSV_URL: z.url().optional(),

  DEFAULT_LOCALE: z.enum(LANGUAGES).default('ca'),
  TZ: z.string().default('Europe/Madrid'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Set by the deploy workflow (`--var GIT_COMMIT:<sha>`) for `/status` and `/health`. */
  GIT_COMMIT: z.string().min(1).default('dev'),
  SENTRY_DSN: z
    .string()
    .refine((value) => value === '' || validSentryDsn(value), 'must be an HTTPS Sentry DSN')
    .optional(),

  /** Dev only, ignored in production (ARCH §4, ADR-0010). */
  DEV_AUTH_BYPASS_TELEGRAM_ID: z.string().regex(/^\d+$/).optional(),
  /**
   * Dev and test only (ARCH §13, §16): where the Bot API lives. The e2e suite points it at a
   * fake Telegram that records what the outbox sent, so a notification can be asserted end
   * to end. Refused in production, where only Telegram may hold the token.
   */
  TELEGRAM_API_ROOT: z.url().optional(),
});

const envSchema = baseSchema.superRefine((env, ctx) => {
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
  if (env.NODE_ENV === 'production' && env.TELEGRAM_API_ROOT) {
    ctx.addIssue({
      code: 'custom',
      path: ['TELEGRAM_API_ROOT'],
      message: 'must not be set in production (ARCH §13)',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/** Validate before SDK initialization too, so an invalid DSN is never printed by the SDK. */
export function validSentryDsn(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      /^[a-zA-Z0-9]+$/.test(url.username) &&
      !url.password &&
      /\/\d+$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Only the string-valued entries: bindings such as Hyperdrive are objects and never vars. */
function variablesOf(source: EnvSource): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') variables[key] = value;
  }
  return variables;
}

export function parseEnv(source: EnvSource): Env {
  const result = envSchema.safeParse(variablesOf(source));
  if (result.success) return result.data;
  throw new EnvError(
    result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  );
}

export function isProduction(e: Pick<Env, 'NODE_ENV'>): boolean {
  return e.NODE_ENV === 'production';
}

/** ARCH §4: the bypass only exists outside production and only when configured. */
export function devAuthBypassId(e: Env): string | undefined {
  return isProduction(e) ? undefined : e.DEV_AUTH_BYPASS_TELEGRAM_ID;
}

/**
 * ARCH §7, §17: the origins a realtime socket may be opened from. `PUBLIC_URL` in every
 * environment; outside production also the Vite dev server and the Worker's own local
 * address, which is where the Mini App is opened during development and in the e2e suite.
 */
export function allowedSocketOrigins(e: Pick<Env, 'PUBLIC_URL' | 'NODE_ENV'>): string[] {
  const origins = new Set([new URL(e.PUBLIC_URL).origin]);
  if (!isProduction(e)) {
    for (const port of [5173, 8080, 8081]) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return [...origins];
}

/** grammY client options: the timeout, and the Bot API root when a test double stands in. */
export function telegramClientOptions(
  e: Pick<Env, 'TELEGRAM_API_ROOT' | 'NODE_ENV'>,
  timeoutSeconds: number,
): { timeoutSeconds: number; apiRoot?: string } {
  const apiRoot = isProduction(e) ? undefined : e.TELEGRAM_API_ROOT;
  return { timeoutSeconds, ...(apiRoot ? { apiRoot } : {}) };
}
