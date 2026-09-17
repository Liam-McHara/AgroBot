import { describe, expect, it } from 'vitest';
import { parseInviteIdentifier } from './admin-members.js';

describe('parseInviteIdentifier (PRD US-1.3)', () => {
  it('reads a Telegram id from digits', () => {
    expect(parseInviteIdentifier(' 123456789 ')).toEqual({
      kind: 'telegramId',
      telegramId: '123456789',
    });
  });

  it('reads a username with or without the @, lower-cased', () => {
    expect(parseInviteIdentifier('@Marta_Hort')).toEqual({
      kind: 'username',
      username: 'marta_hort',
    });
    expect(parseInviteIdentifier('marta')).toEqual({ kind: 'username', username: 'marta' });
  });

  it('rejects what Telegram would not accept as a username', () => {
    expect(parseInviteIdentifier('')).toBeNull();
    expect(parseInviteIdentifier('@ab')).toBeNull();
    expect(parseInviteIdentifier('marta puig')).toBeNull();
    expect(parseInviteIdentifier('1marta')).toBeNull();
    expect(parseInviteIdentifier('https://t.me/marta')).toBeNull();
  });
});
