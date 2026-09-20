import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { SettingKey } from '@agrobot/shared';
import {
  members,
  notifications,
  products,
  settings,
  threadReads,
  type Member,
  type Product,
} from '../src/db/schema/index.js';
import { createOffersService } from '../src/domain/offers/service.js';
import { createReservationsService } from '../src/domain/reservations/service.js';
import { createThreadsService } from '../src/domain/threads/service.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps, type TestDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

/** A fixed instant: 10:00 in Madrid on 2026-09-19. Every step moves it a little. */
const T0 = new Date('2026-09-19T08:00:00Z');
const SECOND = 1_000;
const DAY = 86_400_000;

let deps: TestDeps;
let marta: Member;
let jordi: Member;
let pere: Member;
let eggs: Product;
let reservationId: string;
const clock = { now: T0 };

const tick = (ms = SECOND) => {
  clock.now = new Date(clock.now.getTime() + ms);
};

async function member(telegramId: number, over: Partial<typeof members.$inferInsert> = {}) {
  const [row] = await database!.db
    .insert(members)
    .values({ telegramId, displayName: `Member ${telegramId}`, status: 'approved', ...over })
    .returning();
  return row!;
}

const n9Rows = () =>
  database!.db
    .select()
    .from(notifications)
    .where(eq(notifications.kind, 'N9'))
    .orderBy(asc(notifications.createdAt));
const setSetting = (key: SettingKey, value: number) =>
  database!.db.update(settings).set({ value }).where(eq(settings.key, key));

suite('threads: real Postgres (PRD US-5.1, ARCH §8 step 3)', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
    clock.now = T0;
    const base = testDeps(database!);
    deps = {
      ...base,
      offers: createOffersService({ db: database!.db, hub: base.hub, now: () => clock.now }),
      reservations: createReservationsService({
        db: database!.db,
        hub: base.hub,
        now: () => clock.now,
      }),
      threads: createThreadsService({ db: database!.db, hub: base.hub, now: () => clock.now }),
    };
    marta = await member(1, { displayName: 'Marta', language: 'ca' });
    jordi = await member(2, { displayName: 'Jordi', language: 'es', username: 'jordi_hort' });
    pere = await member(3, { displayName: 'Pere', role: 'admin' });
    [eggs] = (await database!.db
      .insert(products)
      .values({ slug: 'ous', name: 'Ous', nameEs: 'Huevos', unitCode: 'dozen', priceCents: 310 })
      .returning()) as [Product];
    const offer = await deps.offers.publish(marta, { productId: eggs.id, quantity: 6 });
    tick();
    const record = await deps.reservations.create(jordi, { offerId: offer.offer.id, quantity: 2 });
    reservationId = record.reservation.id;
    tick();
    deps.hub.wakes = 0;
    deps.hub.published = [];
  });

  afterAll(async () => {
    await database?.close();
  });

  describe('post (US-5.1)', () => {
    it('writes the message, moves the sender read marker, queues one N9 with the throttle key, wakes the hub and tells both sockets', async () => {
      const record = await deps.threads.post(jordi, reservationId, { body: '  Demà a les 10?  ' });
      expect(record.message).toMatchObject({
        reservationId,
        senderId: jordi.id,
        kind: 'text',
        body: 'Demà a les 10?',
        createdAt: clock.now,
      });
      expect(record.sender).toEqual({ id: jordi.id, displayName: 'Jordi' });

      const reads = await database!.db.select().from(threadReads);
      expect(reads).toMatchObject([
        { reservationId, memberId: jordi.id, lastReadMessageId: record.message.id },
      ]);

      expect(await n9Rows()).toMatchObject([
        {
          memberId: marta.id,
          status: 'queued',
          dedupeKey: `chat:${reservationId}:${marta.id}`,
          payload: {
            reservationId,
            senderName: 'Jordi',
            productName: 'Ous',
            productNameEs: 'Huevos',
            unitCode: 'dozen',
            quantity: 2,
            preview: 'Demà a les 10?',
          },
        },
      ]);
      expect(deps.hub.wakes).toBe(1);
      expect(deps.hub.published).toEqual([
        {
          memberIds: [jordi.id, marta.id],
          event: { type: 'message.new', reservationId },
        },
      ]);
    });

    it('notifies once per unread burst: reading the thread re-arms the throttle', async () => {
      await deps.threads.post(jordi, reservationId, { body: 'Un' });
      tick();
      await deps.threads.post(jordi, reservationId, { body: 'Dos' });
      tick();
      await deps.threads.post(jordi, reservationId, { body: 'Tres' });
      expect(await n9Rows()).toHaveLength(1);
      expect((await n9Rows())[0]!.payload).toMatchObject({ preview: 'Un' });
      // Only the first message woke the hub; the sockets heard all three.
      expect(deps.hub.wakes).toBe(1);
      expect(deps.hub.published.filter((p) => p.event.type === 'message.new')).toHaveLength(3);

      tick();
      const unread = await deps.threads.read(marta, reservationId);
      expect(unread).toMatchObject({ total: 0, incoming: 0, outgoing: 0 });
      expect((await n9Rows())[0]!.dedupeKey).toBeNull();

      tick();
      await deps.threads.post(jordi, reservationId, { body: 'Quatre' });
      const rows = await n9Rows();
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        memberId: marta.id,
        dedupeKey: `chat:${reservationId}:${marta.id}`,
        payload: { preview: 'Quatre' },
      });
    });

    it('sends no N9 while the recipient is looking at the thread, and none to a suspended one', async () => {
      deps.hub.viewing.add(`${marta.id}:${reservationId}`);
      await deps.threads.post(jordi, reservationId, { body: 'Hola?' });
      expect(await n9Rows()).toHaveLength(0);
      expect(deps.hub.wakes).toBe(0);
      expect(deps.hub.published).toHaveLength(1);

      deps.hub.viewing.clear();
      await database!.db
        .update(members)
        .set({ status: 'suspended' })
        .where(eq(members.id, marta.id));
      tick();
      await deps.threads.post(jordi, reservationId, { body: 'Hola??' });
      expect(await n9Rows()).toHaveLength(0);
    });

    it('a reply from the other side is its own burst, to the other recipient', async () => {
      await deps.threads.post(jordi, reservationId, { body: 'Hola' });
      tick();
      await deps.threads.post(marta, reservationId, { body: 'Bon dia' });
      expect(await n9Rows()).toMatchObject([
        { memberId: marta.id, payload: { senderName: 'Jordi', preview: 'Hola' } },
        { memberId: jordi.id, payload: { senderName: 'Marta', preview: 'Bon dia' } },
      ]);
      // Replying counts as reading: Marta's throttle is re-armed by her own reply.
      expect((await n9Rows())[0]!.dedupeKey).toBeNull();
    });

    it('refuses anyone who is not a party, admins included, and an unusable body', async () => {
      await expect(deps.threads.post(pere, reservationId, { body: 'Hi' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(deps.threads.list(pere, reservationId, {})).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(deps.threads.read(pere, reservationId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(deps.threads.post(jordi, reservationId, { body: '   ' })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(
        deps.threads.post(jordi, reservationId, { body: 'x'.repeat(2001) }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        deps.threads.post(jordi, '00000000-0000-4000-8000-000000000000', { body: 'x' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await n9Rows()).toHaveLength(0);
    });
  });

  describe('read-only window (US-5.1)', () => {
    it('stays writable for thread_readonly_days_after_close after closing, then refuses with THREAD_READONLY', async () => {
      await deps.reservations.act(marta, reservationId, 'confirm');
      tick();
      await deps.reservations.act(marta, reservationId, 'deliver');
      const closedAt = clock.now;

      clock.now = new Date(closedAt.getTime() + 7 * DAY - 60 * SECOND);
      await deps.threads.post(jordi, reservationId, { body: 'Gràcies!' });
      const record = await deps.reservations.get(jordi, reservationId);
      expect(await deps.threads.summary(jordi, record)).toEqual({
        writable: true,
        writableUntil: new Date(closedAt.getTime() + 7 * DAY),
        unread: 0,
      });

      clock.now = new Date(closedAt.getTime() + 8 * DAY);
      await expect(
        deps.threads.post(marta, reservationId, { body: 'De res' }),
      ).rejects.toMatchObject({
        code: 'THREAD_READONLY',
        details: {
          closedAt: closedAt.toISOString(),
          writableUntil: new Date(closedAt.getTime() + 7 * DAY).toISOString(),
        },
      });
      expect(await deps.threads.summary(marta, record)).toEqual({
        writable: false,
        writableUntil: new Date(closedAt.getTime() + 7 * DAY),
        unread: 1,
      });
      // Reading is still allowed: the thread is read-only, not gone.
      const page = await deps.threads.list(marta, reservationId, {});
      expect(page.messages.map((m) => m.message.body)).toEqual([
        'created',
        'confirmed',
        'delivered',
        'Gràcies!',
      ]);
      expect(await deps.threads.read(marta, reservationId)).toMatchObject({ total: 0 });
    });

    it('follows the group setting', async () => {
      await setSetting('thread_readonly_days_after_close', 1);
      await deps.reservations.act(jordi, reservationId, 'cancel');
      clock.now = new Date(clock.now.getTime() + 2 * DAY);
      await expect(deps.threads.post(jordi, reservationId, { body: 'x' })).rejects.toMatchObject({
        code: 'THREAD_READONLY',
      });
    });
  });

  describe('list (ARCH §11 messages)', () => {
    it('pages oldest first from `after`, with system lines and senders', async () => {
      await deps.threads.post(jordi, reservationId, { body: 'Un' });
      tick();
      await deps.threads.post(marta, reservationId, { body: 'Dos' });
      tick();
      await deps.reservations.act(marta, reservationId, 'confirm');
      tick();
      await deps.threads.post(jordi, reservationId, { body: 'Tres' });

      const first = await deps.threads.list(marta, reservationId, { limit: 2 });
      expect(first.hasMore).toBe(true);
      expect(
        first.messages.map((m) => [m.message.kind, m.message.body, m.sender?.displayName]),
      ).toEqual([
        ['system', 'created', undefined],
        ['text', 'Un', 'Jordi'],
      ]);
      expect(first.messages[0]!.message.meta).toMatchObject({
        event: 'created',
        actorName: 'Jordi',
      });

      const second = await deps.threads.list(marta, reservationId, {
        after: first.messages[1]!.message.id,
        limit: 2,
      });
      expect(second.hasMore).toBe(true);
      expect(second.messages.map((m) => m.message.body)).toEqual(['Dos', 'confirmed']);

      const third = await deps.threads.list(marta, reservationId, {
        after: second.messages[1]!.message.id,
        limit: 2,
      });
      expect(third.hasMore).toBe(false);
      expect(third.messages.map((m) => m.message.body)).toEqual(['Tres']);

      await expect(
        deps.threads.list(marta, reservationId, { after: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  describe('unread counts (US-4.6)', () => {
    it('counts the counterpart text messages after the read marker, per side; system lines never count', async () => {
      await deps.threads.post(jordi, reservationId, { body: 'Un' });
      tick();
      await deps.threads.post(jordi, reservationId, { body: 'Dos' });
      tick();
      await deps.reservations.act(marta, reservationId, 'confirm');
      tick();

      const forMarta = await deps.threads.unread(marta);
      expect(forMarta).toMatchObject({ total: 2, incoming: 2, outgoing: 0 });
      expect(forMarta.byReservation.get(reservationId)).toBe(2);
      // Jordi wrote them, and the confirmation is a system line: nothing unread for him.
      expect(await deps.threads.unread(jordi)).toMatchObject({
        total: 0,
        incoming: 0,
        outgoing: 0,
      });

      await deps.threads.read(marta, reservationId);
      expect(await deps.threads.unread(marta)).toMatchObject({ total: 0 });

      tick();
      await deps.threads.post(marta, reservationId, { body: 'Tres' });
      const forJordi = await deps.threads.unread(jordi);
      expect(forJordi).toMatchObject({ total: 1, incoming: 0, outgoing: 1 });
      expect(await deps.threads.unread(pere)).toMatchObject({ total: 0 });
    });

    it('ignores threads of reservations that left the closed tab', async () => {
      await deps.threads.post(jordi, reservationId, { body: 'Un' });
      tick();
      await deps.reservations.act(marta, reservationId, 'reject');
      expect((await deps.threads.unread(marta)).total).toBe(1);
      clock.now = new Date(clock.now.getTime() + 31 * DAY);
      expect((await deps.threads.unread(marta)).total).toBe(0);
    });
  });
});
