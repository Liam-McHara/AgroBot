import { describe, expect, it, vi } from 'vitest';
import type { MessageView } from '@agrobot/shared';
import { loadThread, mergeMessage, stampStyle, systemLine, telegramLink } from './thread.js';

const message = (id: string, createdAt: string): MessageView => ({
  id,
  reservationId: '33333333-3333-4333-8333-333333333333',
  kind: 'text',
  body: id,
  sender: { id: '44444444-4444-4444-8444-444444444444', displayName: 'Jordi' },
  mine: false,
  meta: null,
  createdAt,
});

describe('thread helpers (PRD US-5.1, US-5.2)', () => {
  it('loads every page of a thread, following `after` until none remain', async () => {
    const a = message('a', '2026-09-19T08:00:00.000Z');
    const b = message('b', '2026-09-19T08:01:00.000Z');
    const c = message('c', '2026-09-19T08:02:00.000Z');
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ messages: [a, b], hasMore: true })
      .mockResolvedValueOnce({ messages: [c], hasMore: false });
    expect(await loadThread('r', fetchPage)).toEqual([a, b, c]);
    expect(fetchPage.mock.calls).toEqual([
      ['r', undefined],
      ['r', 'b'],
    ]);
  });

  it('merges a message in order, replacing one already held', () => {
    const a = message('a', '2026-09-19T08:00:00.000Z');
    const b = message('b', '2026-09-19T08:02:00.000Z');
    const between = message('m', '2026-09-19T08:01:00.000Z');
    expect(mergeMessage([a, b], between).map((m) => m.id)).toEqual(['a', 'm', 'b']);
    expect(mergeMessage([a, b], { ...b, body: 'edited' }).map((m) => m.body)).toEqual([
      'a',
      'edited',
    ]);
  });

  it('words a system line from its meta, naming the cause when there is no actor', () => {
    expect(
      systemLine({
        event: 'confirmed',
        actorId: 'x',
        actorName: 'Marta',
        reason: null,
        cause: null,
      }),
    ).toEqual({ key: 'thread.system.confirmed', params: { actor: 'Marta' } });
    expect(
      systemLine({
        event: 'cancelled',
        actorId: null,
        actorName: null,
        reason: null,
        cause: 'product_rejected',
      }),
    ).toEqual({ key: 'thread.system.cancelled_product_rejected', params: {} });
    expect(
      systemLine({ event: 'expired', actorId: null, actorName: null, reason: null, cause: null }),
    ).toEqual({ key: 'thread.system.expired', params: { actor: '' } });
  });

  it('offers the native conversation only with a username, and stamps today by time', () => {
    expect(telegramLink('jordi_hort')).toBe('https://t.me/jordi_hort');
    expect(telegramLink(null)).toBeNull();
    const now = new Date('2026-09-19T10:00:00Z');
    expect(stampStyle('2026-09-19T06:30:00.000Z', now)).toBe('time');
    // 22:30 on the farm the evening before (Madrid is UTC+2 in September).
    expect(stampStyle('2026-09-18T20:30:00.000Z', now)).toBe('datetime');
  });
});
