import { describe, expect, it } from 'vitest';
import { miniAppLink, parseQuickAction, quickActionData } from './deep-links.js';

const env = { BOT_USERNAME: 'AgroBotTest', MINIAPP_SHORT_NAME: 'app' };

describe('deep links (ARCH §4)', () => {
  it('builds the Mini App link with and without a start parameter', () => {
    expect(miniAppLink(env)).toBe('https://t.me/AgroBotTest/app');
    expect(miniAppLink(env, 'a_members')).toBe('https://t.me/AgroBotTest/app?startapp=a_members');
  });

  it('round-trips quick-action callback data within 64 bytes', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const data = quickActionData('approve', id);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(parseQuickAction(data)).toEqual({ action: 'approve', entityId: id });
  });

  it('knows the offer quick actions of N10 (PRD US-3.4)', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect(parseQuickAction(quickActionData('still', id))).toEqual({
      action: 'still',
      entityId: id,
    });
    expect(parseQuickAction(quickActionData('withdraw', id))).toEqual({
      action: 'withdraw',
      entityId: id,
    });
  });

  it('ignores callback data it does not know', () => {
    expect(parseQuickAction('confirm:abc')).toBeNull();
    expect(parseQuickAction('confirm:22222222-2222-4222-8222-222222222222')).toBeNull();
    expect(parseQuickAction('approve:not-a-uuid')).toBeNull();
  });
});
