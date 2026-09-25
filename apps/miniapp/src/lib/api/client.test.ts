import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, authorizationHeader, setDevTelegramId } from './client.js';
import { resetTelegram } from '../telegram.js';

vi.mock('@telegram-apps/sdk', () => ({
  init: () => {},
  restoreInitData: () => {},
  initDataRaw: () => insideTelegramRaw,
  initDataUser: () => undefined,
  mountThemeParamsSync: () => {},
  bindThemeParamsCssVars: () => {},
  miniAppReady: () => {},
}));

let insideTelegramRaw: string | undefined;

beforeEach(() => {
  insideTelegramRaw = undefined;
  resetTelegram();
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetTelegram();
});

describe('authorizationHeader', () => {
  it('sends the signed initData verbatim when inside Telegram (ARCH §4)', () => {
    insideTelegramRaw = 'user=%7B%7D&hash=abc';
    expect(authorizationHeader()).toBe('tma user=%7B%7D&hash=abc');
  });

  it('falls back to the dev bypass outside Telegram', () => {
    setDevTelegramId('900000002');
    expect(authorizationHeader()).toBe('dev 900000002');
  });

  it('sends nothing when there is neither', () => {
    expect(authorizationHeader()).toBeNull();
  });
});

describe('apiFetch', () => {
  it('calls the API under /api with the authorization header', async () => {
    insideTelegramRaw = 'user=%7B%7D&hash=abc';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 200 }));

    await expect(apiFetch<{ id: string }>('/me')).resolves.toEqual({ id: 'x' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/me');
    expect(new Headers(init?.headers).get('authorization')).toBe('tma user=%7B%7D&hash=abc');
  });

  it('turns the ARCH §11 error envelope into an ApiError with its localized message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_APPROVED', message: 'El teu accés…' } }), {
        status: 403,
      }),
    );

    await expect(apiFetch('/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'NOT_APPROVED',
      message: 'El teu accés…',
    });
  });

  it('still fails usefully when the body is not our envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }));
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiError);
  });
  it('handles an HTML proxy error and retains a structured request id for the toast', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>bad gateway</html>', {
        status: 502,
        headers: { 'x-request-id': 'reference-123' },
      }),
    );
    await expect(apiFetch('/me')).rejects.toMatchObject({
      code: 'INTERNAL',
      requestId: 'reference-123',
      message: expect.stringContaining('reference-123'),
    });
  });
});
