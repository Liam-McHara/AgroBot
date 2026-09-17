import { createHmac, timingSafeEqual } from 'node:crypto';
import { languageFromTelegram, type Language } from '@agrobot/shared';

/**
 * Telegram Mini App `initData` validation (ARCH §4, §17, ADR-0010).
 *
 * The signature is HMAC-SHA256 of the sorted `key=value` pairs, keyed by
 * HMAC-SHA256(bot token) under the constant "WebAppData". Comparison is constant-time and
 * `auth_date` older than the window is rejected, so a captured payload is not a login.
 */

export interface TelegramUser {
  id: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  language: Language;
}

export interface InitData {
  user: TelegramUser;
  authDate: Date;
  startParam: string | null;
}

export type InitDataFailure =
  'malformed' | 'missing_hash' | 'bad_signature' | 'stale' | 'missing_user';

export type InitDataResult = { ok: true; data: InitData } | { ok: false; reason: InitDataFailure };

/** ARCH §4: `auth_date` older than 24 h is refused. */
export const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface VerifyOptions {
  maxAgeSeconds?: number;
  now?: Date;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would leak the length by throwing.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseUser(raw: string | undefined): TelegramUser | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const user = parsed as Record<string, unknown>;
  if (typeof user['id'] !== 'number' || !Number.isSafeInteger(user['id'])) return null;
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;
  return {
    id: user['id'],
    username: text(user['username']),
    firstName: text(user['first_name']),
    lastName: text(user['last_name']),
    language: languageFromTelegram(text(user['language_code'])),
  };
}

export function verifyInitData(
  initDataRaw: string,
  botToken: string,
  options: VerifyOptions = {},
): InitDataResult {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initDataRaw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };

  const checkString = [...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(checkString).digest('hex');
  if (!constantTimeEquals(hash, expected)) return { ok: false, reason: 'bad_signature' };

  const authDateRaw = params.get('auth_date');
  const authDateSeconds = authDateRaw === null ? Number.NaN : Number(authDateRaw);
  if (!Number.isFinite(authDateSeconds)) return { ok: false, reason: 'malformed' };

  const now = options.now ?? new Date();
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const ageSeconds = now.getTime() / 1000 - authDateSeconds;
  if (ageSeconds > maxAge || ageSeconds < -maxAge) return { ok: false, reason: 'stale' };

  const user = parseUser(params.get('user') ?? undefined);
  if (!user) return { ok: false, reason: 'missing_user' };

  return {
    ok: true,
    data: {
      user,
      authDate: new Date(authDateSeconds * 1000),
      startParam: params.get('start_param'),
    },
  };
}

/** Builds a signed `initData` string. Used by the tests and by the e2e fixtures. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const checkString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(checkString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}
