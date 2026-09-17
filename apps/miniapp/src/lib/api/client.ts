import type { ErrorBody } from '@agrobot/shared';
import { initTelegram } from '../telegram.js';

/**
 * The fetch wrapper of ARCH §12: it adds the `tma` authorization header and, outside Telegram,
 * the development bypass of ARCH §4. The bypass id comes from `localStorage` (so two tabs can
 * be two members) or from `VITE_DEV_TELEGRAM_ID` at build time; the server only honours the
 * `dev` scheme when `DEV_AUTH_BYPASS_TELEGRAM_ID` is configured, never in production, so the
 * client does not need to gate it further — which is what lets the e2e suite drive the built
 * app (ARCH §15).
 */

const DEV_MEMBER_STORAGE_KEY = 'agrobot.devTelegramId';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function devTelegramId(): string | null {
  let stored: string | null = null;
  try {
    stored = globalThis.localStorage?.getItem(DEV_MEMBER_STORAGE_KEY) ?? null;
  } catch {
    /* storage can be unavailable; the build-time id below still applies */
  }
  return stored ?? (import.meta.env['VITE_DEV_TELEGRAM_ID'] as string | undefined) ?? null;
}

export function setDevTelegramId(telegramId: string): void {
  globalThis.localStorage?.setItem(DEV_MEMBER_STORAGE_KEY, telegramId);
}

export function authorizationHeader(): string | null {
  const telegram = initTelegram();
  if (telegram.initDataRaw) return `tma ${telegram.initDataRaw}`;
  const devId = devTelegramId();
  return devId ? `dev ${devId}` : null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  const authorization = authorizationHeader();
  if (authorization) headers.set('authorization', authorization);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(`/api${path}`, { ...init, headers });
  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const body = payload as ErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error.code ?? 'INTERNAL',
      body?.error.message ?? `HTTP ${response.status}`,
      body?.error.details,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
