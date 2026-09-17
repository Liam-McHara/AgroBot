import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockTelegramEnv } from '@telegram-apps/sdk';
import { initTelegram, resetTelegram } from './telegram.js';

/**
 * These tests drive the **real** `@telegram-apps/sdk` — no mock — against an imitated
 * Telegram environment, so the launch parameters travel through the SDK's own parser.
 *
 * That is deliberate. The SDK pins valibot at 1.0.0, which carries a ReDoS advisory
 * (GHSA-vqpr-j7v3-hqw9); the workspace overrides it to a patched 1.x. This file is what
 * proves the override did not quietly break `initData` parsing, which nothing else would
 * catch: the other Mini App tests mock the SDK away.
 */

const INIT_DATA_RAW = new URLSearchParams({
  user: JSON.stringify({
    id: 900000002,
    first_name: 'Jordi',
    last_name: 'Ferrer',
    username: 'jordi',
    language_code: 'es',
    // The field whose validator the ReDoS advisory concerns.
    photo_url: 'https://t.me/i/userpic/320/jordi.jpg',
  }),
  auth_date: String(Math.floor(Date.now() / 1000)),
  signature: 'test-signature',
  hash: 'f'.repeat(64),
  start_param: 'r_9f1c0c4e-0000-4000-8000-000000000000',
}).toString();

function mockLaunch(initDataRaw: string = INIT_DATA_RAW): void {
  mockTelegramEnv({
    launchParams: new URLSearchParams({
      tgWebAppData: initDataRaw,
      tgWebAppVersion: '8.0',
      tgWebAppPlatform: 'tdesktop',
      tgWebAppThemeParams: JSON.stringify({ bg_color: '#ffffff', text_color: '#000000' }),
    }).toString(),
    resetPostMessage: true,
  });
}

beforeEach(() => {
  resetTelegram();
  // The SDK remembers launch parameters in session storage, so one test's imitated launch
  // would otherwise still be there for the next.
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  resetTelegram();
});

describe('initTelegram inside Telegram', () => {
  it('recovers the raw initData the server will verify', () => {
    mockLaunch();
    const telegram = initTelegram();

    expect(telegram.inside).toBe(true);
    expect(telegram.initDataRaw).toBeTruthy();
    // Whatever the SDK does internally, the server needs these three verbatim: they are what
    // the HMAC of ARCH §4 is computed over.
    const parsed = new URLSearchParams(telegram.initDataRaw!);
    expect(parsed.get('hash')).toBe('f'.repeat(64));
    expect(parsed.get('user')).toBe(new URLSearchParams(INIT_DATA_RAW).get('user'));
    expect(parsed.get('auth_date')).toBe(new URLSearchParams(INIT_DATA_RAW).get('auth_date'));
  });

  it('reads the language the UI starts in before /me answers', () => {
    mockLaunch();
    expect(initTelegram().languageCode).toBe('es');
  });

  it('reads the deep-link start parameter (ARCH §4)', () => {
    mockLaunch();
    expect(initTelegram().startParam).toBe('r_9f1c0c4e-0000-4000-8000-000000000000');
  });

  it('caches, so every screen sees one launch', () => {
    mockLaunch();
    expect(initTelegram()).toBe(initTelegram());
  });
});

describe('initTelegram outside Telegram', () => {
  it('reports that it is not inside rather than throwing', () => {
    // No imitated launch at all: this is `pnpm dev` in a plain browser tab, where the app
    // must fall back to the development bypass instead of failing to start (ARCH §4).
    const telegram = initTelegram();
    expect(telegram.inside).toBe(false);
    expect(telegram.initDataRaw).toBeNull();
    expect(telegram.startParam).toBeNull();
  });
});

describe('routeForStartParam (ARCH §4)', () => {
  it('maps the deep-link grammar to routes and ignores the rest', async () => {
    const { routeForStartParam } = await import('./telegram.js');
    expect(routeForStartParam('a_members')).toBe('/admin/members');
    expect(routeForStartParam('r_9f1c0c4e-0000-4000-8000-000000000000')).toBe(
      '/reservations/9f1c0c4e-0000-4000-8000-000000000000',
    );
    expect(routeForStartParam('o_9f1c0c4e-0000-4000-8000-000000000000')).toBe(
      '/offers/9f1c0c4e-0000-4000-8000-000000000000',
    );
    expect(routeForStartParam('x_whatever')).toBeNull();
    expect(routeForStartParam(null)).toBeNull();
  });
});
