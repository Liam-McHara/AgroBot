import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from './init-data.js';

const BOT_TOKEN = '123456:test-token-for-unit-tests';
const NOW = new Date('2026-09-17T12:00:00Z');

function initDataFor(
  user: Record<string, unknown>,
  authDate: Date = NOW,
  extra: Record<string, string> = {},
): string {
  return signInitData(
    {
      user: JSON.stringify(user),
      auth_date: String(Math.floor(authDate.getTime() / 1000)),
      query_id: 'AAE',
      ...extra,
    },
    BOT_TOKEN,
  );
}

describe('verifyInitData', () => {
  it('accepts data signed with the bot token', () => {
    const raw = initDataFor({
      id: 42,
      first_name: 'Marta',
      last_name: 'Puig',
      username: 'marta',
      language_code: 'ca',
    });
    const result = verifyInitData(raw, BOT_TOKEN, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.user).toEqual({
      id: 42,
      username: 'marta',
      firstName: 'Marta',
      lastName: 'Puig',
      language: 'ca',
    });
    expect(result.data.authDate.toISOString()).toBe(NOW.toISOString());
  });

  it('maps the Telegram language code to a supported language', () => {
    const raw = initDataFor({ id: 1, first_name: 'Jordi', language_code: 'es-ES' });
    const result = verifyInitData(raw, BOT_TOKEN, { now: NOW });
    expect(result.ok && result.data.user.language).toBe('es');
  });

  it('reads the deep-link start parameter (ARCH §4)', () => {
    const raw = initDataFor({ id: 1, first_name: 'Jordi' }, NOW, { start_param: 'r_abc' });
    const result = verifyInitData(raw, BOT_TOKEN, { now: NOW });
    expect(result.ok && result.data.startParam).toBe('r_abc');
  });

  it('rejects a tampered payload', () => {
    const raw = initDataFor({ id: 42, first_name: 'Marta' });
    const tampered = raw.replace('%22id%22%3A42', '%22id%22%3A43');
    expect(tampered).not.toBe(raw);
    expect(verifyInitData(tampered, BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a payload signed with a different bot token', () => {
    const raw = initDataFor({ id: 42, first_name: 'Marta' });
    expect(verifyInitData(raw, 'another:token', { now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a missing hash', () => {
    expect(verifyInitData('user=%7B%7D&auth_date=1', BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'missing_hash',
    });
  });

  it('rejects a hash of the wrong length without throwing', () => {
    const raw = `${initDataFor({ id: 42, first_name: 'Marta' })}`.replace(/hash=\w+/, 'hash=abc');
    expect(verifyInitData(raw, BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects data older than the window', () => {
    const raw = initDataFor({ id: 42, first_name: 'Marta' }, new Date('2026-09-16T11:00:00Z'));
    expect(verifyInitData(raw, BOT_TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'stale' });
  });

  it('accepts data just inside the window', () => {
    const raw = initDataFor({ id: 42, first_name: 'Marta' }, new Date('2026-09-16T12:30:00Z'));
    expect(verifyInitData(raw, BOT_TOKEN, { now: NOW }).ok).toBe(true);
  });

  it('rejects data from the future beyond the window (a wrong clock, or a forgery)', () => {
    const raw = initDataFor({ id: 42, first_name: 'Marta' }, new Date('2026-09-19T12:00:00Z'));
    expect(verifyInitData(raw, BOT_TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects a signature over a payload with no user', () => {
    const raw = signInitData({ auth_date: String(Math.floor(NOW.getTime() / 1000)) }, BOT_TOKEN);
    expect(verifyInitData(raw, BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'missing_user',
    });
  });

  it('rejects a user without a numeric id', () => {
    const raw = initDataFor({ id: 'not-a-number', first_name: 'Marta' });
    expect(verifyInitData(raw, BOT_TOKEN, { now: NOW })).toEqual({
      ok: false,
      reason: 'missing_user',
    });
  });

  it('treats missing optional user fields as null', () => {
    const raw = initDataFor({ id: 7 });
    const result = verifyInitData(raw, BOT_TOKEN, { now: NOW });
    expect(result.ok && result.data.user).toEqual({
      id: 7,
      username: null,
      firstName: null,
      lastName: null,
      language: 'ca',
    });
  });
});
