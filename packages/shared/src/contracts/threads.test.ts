import { describe, expect, it } from 'vitest';
import {
  messageSchema,
  messagesQuerySchema,
  postMessageSchema,
  THREAD_PAGE_SIZE,
} from './threads.js';

describe('thread contracts (PRD US-5.1, ARCH §11)', () => {
  it('trims a message and keeps it between 1 and 2000 characters', () => {
    expect(postMessageSchema.parse({ body: '  Demà a les 10?  ' })).toEqual({
      body: 'Demà a les 10?',
    });
    expect(postMessageSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(postMessageSchema.safeParse({ body: 'x'.repeat(2000) }).success).toBe(true);
    expect(postMessageSchema.safeParse({ body: 'x'.repeat(2001) }).success).toBe(false);
    expect(postMessageSchema.safeParse({}).success).toBe(false);
  });

  it('pages forward from `after` with a bounded, coerced limit', () => {
    expect(messagesQuerySchema.parse({})).toEqual({ limit: THREAD_PAGE_SIZE });
    expect(messagesQuerySchema.parse({ limit: '2' })).toEqual({ limit: 2 });
    const after = '11111111-1111-4111-8111-111111111111';
    expect(messagesQuerySchema.parse({ after })).toEqual({ after, limit: THREAD_PAGE_SIZE });
    expect(messagesQuerySchema.safeParse({ after: 'last' }).success).toBe(false);
    expect(messagesQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(messagesQuerySchema.safeParse({ limit: THREAD_PAGE_SIZE + 1 }).success).toBe(false);
  });

  it('describes a system line by its meta and a text message by its sender', () => {
    const base = {
      id: '22222222-2222-4222-8222-222222222222',
      reservationId: '33333333-3333-4333-8333-333333333333',
      createdAt: '2026-09-19T08:00:00.000Z',
    };
    expect(
      messageSchema.safeParse({
        ...base,
        kind: 'system',
        body: 'confirmed',
        sender: null,
        mine: false,
        meta: { event: 'confirmed', actorId: null, actorName: 'Marta', reason: null, cause: null },
      }).success,
    ).toBe(true);
    expect(
      messageSchema.safeParse({
        ...base,
        kind: 'text',
        body: 'Hola',
        sender: { id: '44444444-4444-4444-8444-444444444444', displayName: 'Jordi' },
        mine: true,
        meta: null,
      }).success,
    ).toBe(true);
    expect(
      messageSchema.safeParse({
        ...base,
        kind: 'system',
        body: 'vanished',
        sender: null,
        mine: false,
        meta: { event: 'vanished', actorId: null, actorName: null, reason: null, cause: null },
      }).success,
    ).toBe(false);
  });
});
