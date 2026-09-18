import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { members, notifications, offers, products, reservations } from '../src/db/schema/index.js';
import { nextDispatchDueAt, nextExpiryDueAt, nextReminderDueAt } from '../src/jobs/deadlines.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

const at = (iso: string) => new Date(iso);

suite('deadline lookups for the hub (ARCH §9)', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
  });

  afterAll(async () => {
    await database?.close();
  });

  async function member(telegramId: number) {
    const [row] = await database!.db
      .insert(members)
      .values({ telegramId, displayName: `Member ${telegramId}`, status: 'approved' })
      .returning();
    return row!;
  }

  it('notifications.dispatch: the earliest queued next_attempt_at, ignoring sent and failed', async () => {
    const m = await member(1);
    expect(await nextDispatchDueAt(database!.db)).toBeNull();
    await database!.db.insert(notifications).values([
      { memberId: m.id, kind: 'N2', payload: {}, nextAttemptAt: at('2026-07-01T10:05:00Z') },
      { memberId: m.id, kind: 'N2', payload: {}, nextAttemptAt: at('2026-07-01T10:01:00Z') },
      {
        memberId: m.id,
        kind: 'N2',
        payload: {},
        status: 'sent',
        nextAttemptAt: at('2026-07-01T09:00:00Z'),
      },
      {
        memberId: m.id,
        kind: 'N2',
        payload: {},
        status: 'failed',
        nextAttemptAt: at('2026-07-01T08:00:00Z'),
      },
    ]);
    expect((await nextDispatchDueAt(database!.db))?.toISOString()).toBe('2026-07-01T10:01:00.000Z');
  });

  it('reservations.remind and reservations.expire read pending reservations only', async () => {
    const producer = await member(2);
    const requester = await member(3);
    const [product] = await database!.db
      .insert(products)
      .values({ slug: 'ous', name: 'Ous', unitCode: 'dozen', priceCents: 300 })
      .returning();
    const [offer] = await database!.db
      .insert(offers)
      .values({ producerId: producer.id, productId: product!.id, quantity: '10' })
      .returning();
    const base = {
      offerId: offer!.id,
      requesterId: requester.id,
      producerId: producer.id,
      quantity: '1',
      unitPriceCents: 300,
    };
    expect(await nextExpiryDueAt(database!.db)).toBeNull();
    expect(await nextReminderDueAt(database!.db, 12)).toBeNull();

    await database!.db.insert(reservations).values([
      { ...base, status: 'pending', expiresAt: at('2026-07-03T12:00:00Z') },
      { ...base, status: 'pending', expiresAt: at('2026-07-02T12:00:00Z') },
      // Already reminded: not a reminder deadline any more, still an expiry one.
      {
        ...base,
        status: 'pending',
        expiresAt: at('2026-07-02T06:00:00Z'),
        remindedAt: at('2026-07-01T18:00:00Z'),
      },
      // Confirmed reservations have no expiry.
      { ...base, status: 'confirmed', expiresAt: null },
      // Closed ones are history.
      { ...base, status: 'expired', expiresAt: at('2026-06-30T12:00:00Z') },
    ]);

    expect((await nextExpiryDueAt(database!.db))?.toISOString()).toBe('2026-07-02T06:00:00.000Z');
    expect((await nextReminderDueAt(database!.db, 12))?.toISOString()).toBe(
      '2026-07-02T00:00:00.000Z',
    );
    expect((await nextReminderDueAt(database!.db, 1.5))?.toISOString()).toBe(
      '2026-07-02T10:30:00.000Z',
    );
  });
});
