import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import type { NotificationKind, SettingKey } from '@agrobot/shared';
import {
  members,
  messages,
  notifications,
  offers,
  products,
  reservations,
  settings,
  type Member,
  type Product,
} from '../src/db/schema/index.js';
import { createOffersService } from '../src/domain/offers/service.js';
import { createReservationsService } from '../src/domain/reservations/service.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps, type TestDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

/** A fixed instant: 10:00 in Madrid on 2026-09-19. */
const NOW = new Date('2026-09-19T08:00:00Z');
const HOUR = 3_600_000;

let deps: TestDeps;
let marta: Member;
let jordi: Member;
let pere: Member;
let eggs: Product;
const clock = { now: NOW };

async function member(telegramId: number, over: Partial<typeof members.$inferInsert> = {}) {
  const [row] = await database!.db
    .insert(members)
    .values({ telegramId, displayName: `Member ${telegramId}`, status: 'approved', ...over })
    .returning();
  return row!;
}

const queued = (kind: NotificationKind) =>
  database!.db
    .select()
    .from(notifications)
    .where(eq(notifications.kind, kind))
    .orderBy(asc(notifications.createdAt));
const lines = (reservationId: string) =>
  database!.db
    .select()
    .from(messages)
    .where(eq(messages.reservationId, reservationId))
    .orderBy(asc(messages.createdAt));
const offerRow = async (id: string) =>
  (await database!.db.select().from(offers).where(eq(offers.id, id)))[0]!;
const reservationRow = async (id: string) =>
  (await database!.db.select().from(reservations).where(eq(reservations.id, id)))[0]!;
const setSetting = (key: SettingKey, value: number) =>
  database!.db.update(settings).set({ value }).where(eq(settings.key, key));

suite('reservations: real Postgres (PRD §8, ARCH §6)', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
    clock.now = NOW;
    const base = testDeps(database!);
    deps = {
      ...base,
      offers: createOffersService({ db: database!.db, hub: base.hub, now: () => clock.now }),
      reservations: createReservationsService({
        db: database!.db,
        hub: base.hub,
        now: () => clock.now,
      }),
    };
    marta = await member(1, { displayName: 'Marta', language: 'ca' });
    jordi = await member(2, { displayName: 'Jordi', language: 'es', username: 'jordi_hort' });
    pere = await member(3, { displayName: 'Pere' });
    [eggs] = (await database!.db
      .insert(products)
      .values({ slug: 'ous', name: 'Ous', nameEs: 'Huevos', unitCode: 'dozen', priceCents: 310 })
      .returning()) as [Product];
  });

  afterAll(async () => {
    await database?.close();
  });

  async function publish(producer: Member, quantity: number, product = eggs) {
    const record = await deps.offers.publish(producer, { productId: product.id, quantity });
    deps.hub.wakes = 0;
    deps.hub.published = [];
    return record.offer;
  }

  describe('create (US-4.1)', () => {
    it('holds the quantity, snapshots the price, sets expires_at, writes the first system line and N6, wakes the hub', async () => {
      const offer = await publish(marta, 6);
      const record = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 2 });

      expect(record.reservation).toMatchObject({
        status: 'pending',
        requesterId: jordi.id,
        producerId: marta.id,
        unitPriceCents: 310,
        quantity: '2.00',
        remindedAt: null,
      });
      expect(record.reservation.expiresAt?.toISOString()).toBe(
        new Date(NOW.getTime() + 48 * HOUR).toISOString(),
      );
      expect(record.quantity).toBe(2);
      expect(record.offerAvailable).toBe(4);
      expect(record.requester).toMatchObject({ displayName: 'Jordi', username: 'jordi_hort' });

      const mine = await deps.offers.mine(marta);
      expect(mine[0]).toMatchObject({ held: 2, available: 4, openReservations: 1 });

      expect(await lines(record.reservation.id)).toMatchObject([
        {
          kind: 'system',
          senderId: null,
          body: 'created',
          meta: { event: 'created', actorId: jordi.id, actorName: 'Jordi' },
        },
      ]);
      expect(await queued('N6')).toMatchObject([
        {
          memberId: marta.id,
          payload: {
            reservationId: record.reservation.id,
            offerId: offer.id,
            productName: 'Ous',
            unitCode: 'dozen',
            quantity: 2,
            unitPriceCents: 310,
            requesterName: 'Jordi',
            producerName: 'Marta',
          },
        },
      ]);
      // ARCH §7, §8, §9: one wake (N6 + a deadline), the parties and every board told.
      expect(deps.hub.wakes).toBe(1);
      expect(deps.hub.published).toEqual([
        {
          memberIds: [jordi.id, marta.id],
          event: { type: 'reservation.changed', id: record.reservation.id },
        },
        expect.objectContaining({ event: { type: 'board.changed' } }),
      ]);
    });

    it('reads the expiry hours from the settings at run time', async () => {
      await setSetting('reservation_expiry_hours', 1 / 60);
      const offer = await publish(marta, 6);
      const record = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 1 });
      expect(record.reservation.expiresAt?.toISOString()).toBe(
        new Date(NOW.getTime() + 60_000).toISOString(),
      );
    });

    it('snapshots no price on a pending product, and the catalogue fills it on resolution (N5)', async () => {
      const [pending] = await database!.db
        .insert(products)
        .values({
          slug: 'carbassa',
          name: 'Carbassa',
          unitCode: 'kg',
          priceCents: null,
          status: 'pending',
          source: 'member',
          proposedBy: marta.id,
        })
        .returning();
      const offer = await publish(marta, 10, pending!);
      const open = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 2.5 });
      const closed = await deps.reservations.create(pere, { offerId: offer.id, quantity: 1 });
      await deps.reservations.act(pere, closed.reservation.id, 'cancel');
      expect(open.reservation.unitPriceCents).toBeNull();

      const catalog = (await import('../src/domain/catalog/service.js')).createCatalogService({
        db: database!.db,
        hub: deps.hub,
        now: () => clock.now,
        source: {
          kind: 'csv',
          sheetUrl: 'https://example.test/catalog.csv',
          fetchRows: async () => [
            ['Producte', 'Unitat', 'Preu'],
            ['Ous', 'dotzena', '3.10'],
            ['Carbassa', 'kg', '1.80'],
          ],
        },
      });
      const report = await catalog.sync({ trigger: 'schedule' });
      expect(report.resolvedPending).toBe(1);
      expect((await reservationRow(open.reservation.id)).unitPriceCents).toBe(180);
      // The cancelled one keeps its history as it was (ARCH §6 price-resolve: open only).
      expect((await reservationRow(closed.reservation.id)).unitPriceCents).toBeNull();
      expect((await queued('N5')).map((n) => n.memberId).sort()).toEqual(
        [marta.id, jordi.id].sort(),
      );
    });

    it('refuses my own offer, a withdrawn or past-date offer, a suspended producer, an off-step quantity and a stranger', async () => {
      const offer = await publish(marta, 6);
      await expect(
        deps.reservations.create(marta, { offerId: offer.id, quantity: 1 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'own_offer' } });
      await expect(
        deps.reservations.create(jordi, { offerId: offer.id, quantity: 1.5 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        deps.reservations.create(jordi, { offerId: offer.id, quantity: 0 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        deps.reservations.create({ ...jordi, status: 'pending' } as Member, {
          offerId: offer.id,
          quantity: 1,
        }),
      ).resolves.toBeTruthy(); // the actor is re-read from the database, not trusted (ARCH §4)
      const applicant = await member(9, { status: 'pending' });
      await expect(
        deps.reservations.create(applicant, { offerId: offer.id, quantity: 1 }),
      ).rejects.toMatchObject({ code: 'NOT_APPROVED' });

      await database!.db
        .update(offers)
        .set({ availableUntil: '2026-09-18' })
        .where(eq(offers.id, offer.id));
      await expect(
        deps.reservations.create(pere, { offerId: offer.id, quantity: 1 }),
      ).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
        details: { reason: 'offer_past_date' },
      });

      await deps.offers.withdraw(marta, offer.id);
      await expect(
        deps.reservations.create(pere, { offerId: offer.id, quantity: 1 }),
      ).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
        details: { reason: 'offer_not_active' },
      });

      const other = await publish(pere, 2);
      await database!.db
        .update(members)
        .set({ status: 'suspended' })
        .where(eq(members.id, pere.id));
      await expect(
        deps.reservations.create(jordi, { offerId: other.id, quantity: 1 }),
      ).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
        details: { reason: 'producer_not_approved' },
      });
      await expect(
        deps.reservations.create(jordi, {
          offerId: '00000000-0000-4000-8000-000000000000',
          quantity: 1,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('answers INSUFFICIENT_AVAILABILITY with what is left, counting pending and confirmed holds', async () => {
      const offer = await publish(marta, 5);
      const first = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 2 });
      await deps.reservations.act(marta, first.reservation.id, 'confirm');
      await deps.reservations.create(pere, { offerId: offer.id, quantity: 2 });
      await expect(
        deps.reservations.create(jordi, { offerId: offer.id, quantity: 2 }),
      ).rejects.toMatchObject({
        code: 'INSUFFICIENT_AVAILABILITY',
        params: { available: 1 },
        details: { available: 1 },
      });
      // Exactly what is left is fine; then nothing is.
      await deps.reservations.create(jordi, { offerId: offer.id, quantity: 1 });
      await expect(
        deps.reservations.create(jordi, { offerId: offer.id, quantity: 1 }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_AVAILABILITY', details: { available: 0 } });
      // The board no longer shows it (US-3.2), the producer sees it fully reserved.
      expect(
        (await deps.offers.board(jordi, { group: 'product', q: '', category: '' })).total,
      ).toBe(0);
      expect((await deps.offers.mine(marta))[0]).toMatchObject({ held: 5, available: 0 });
    });
  });

  describe('confirm, reject, cancel, deliver (US-4.2–4.4)', () => {
    it('confirm clears expires_at, writes the line and N8 to the requester; a second confirm is stale', async () => {
      const offer = await publish(marta, 6);
      const { reservation } = await deps.reservations.create(jordi, {
        offerId: offer.id,
        quantity: 2,
      });
      deps.hub.published = [];
      clock.now = new Date(NOW.getTime() + HOUR);
      const confirmed = await deps.reservations.act(marta, reservation.id, 'confirm');
      expect(confirmed.reservation).toMatchObject({
        status: 'confirmed',
        expiresAt: null,
        closedAt: null,
      });
      expect(confirmed.reservation.confirmedAt?.toISOString()).toBe(clock.now.toISOString());
      expect((await lines(reservation.id)).map((l) => l.body)).toEqual(['created', 'confirmed']);
      expect(await queued('N8')).toMatchObject([
        {
          memberId: jordi.id,
          payload: { decision: 'confirmed', recipient: 'requester', actorName: 'Marta' },
        },
      ]);
      // Confirming holds the same quantity: the parties are told, the boards are not.
      expect(deps.hub.published).toEqual([
        {
          memberIds: [jordi.id, marta.id],
          event: { type: 'reservation.changed', id: reservation.id },
        },
      ]);
      await expect(deps.reservations.act(marta, reservation.id, 'confirm')).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
        details: { status: 'confirmed' },
      });
    });

    it('enforces the actor guards: requester cannot confirm or reject, producer cannot cancel while pending, strangers do nothing', async () => {
      const offer = await publish(marta, 6);
      const { reservation } = await deps.reservations.create(jordi, {
        offerId: offer.id,
        quantity: 2,
      });
      for (const action of ['confirm', 'reject', 'confirm-and-deliver'] as const) {
        await expect(deps.reservations.act(jordi, reservation.id, action)).rejects.toMatchObject({
          code: 'FORBIDDEN',
          details: { reason: 'not_for_party' },
        });
      }
      await expect(deps.reservations.act(marta, reservation.id, 'cancel')).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });
      await expect(deps.reservations.act(jordi, reservation.id, 'deliver')).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });
      await expect(deps.reservations.act(pere, reservation.id, 'cancel')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        details: { reason: 'not_party' },
      });
      await expect(deps.reservations.get(pere, reservation.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect((await reservationRow(reservation.id)).status).toBe('pending');
    });

    it('reject releases the quantity with a reason; cancel works for the requester and, once confirmed, the producer', async () => {
      const offer = await publish(marta, 6);
      const a = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 2 });
      const b = await deps.reservations.create(pere, { offerId: offer.id, quantity: 3 });
      const rejected = await deps.reservations.act(marta, a.reservation.id, 'reject', {
        reason: 'Ja no en tinc',
      });
      expect(rejected.reservation).toMatchObject({
        status: 'rejected',
        reason: 'Ja no en tinc',
        closedBy: marta.id,
        expiresAt: null,
      });
      expect(rejected.reservation.closedAt).not.toBeNull();
      expect(rejected.offerAvailable).toBe(3);
      expect(await queued('N8')).toMatchObject([
        { memberId: jordi.id, payload: { decision: 'rejected', reason: 'Ja no en tinc' } },
      ]);
      expect(deps.hub.published.at(-1)).toMatchObject({ event: { type: 'board.changed' } });

      await deps.reservations.act(marta, b.reservation.id, 'confirm');
      const cancelled = await deps.reservations.act(marta, b.reservation.id, 'cancel');
      expect(cancelled.reservation).toMatchObject({ status: 'cancelled', closedBy: marta.id });
      expect(cancelled.offerAvailable).toBe(6);
      expect((await queued('N8')).at(-1)).toMatchObject({
        memberId: pere.id,
        payload: { decision: 'cancelled', recipient: 'requester', actorName: 'Marta' },
      });

      const c = await deps.reservations.create(pere, { offerId: offer.id, quantity: 1 });
      const byRequester = await deps.reservations.act(pere, c.reservation.id, 'cancel', {
        reason: 'M’he equivocat',
      });
      expect(byRequester.reservation).toMatchObject({ status: 'cancelled', closedBy: pere.id });
      expect((await queued('N8')).at(-1)).toMatchObject({
        memberId: marta.id,
        payload: { decision: 'cancelled', recipient: 'producer', reason: 'M’he equivocat' },
      });
      expect(
        await deps.reservations.act(marta, c.reservation.id, 'reject').catch((e) => e.code),
      ).toBe('INVALID_TRANSITION');
    });

    it('deliver deducts the quantity from the offer so it is gone, not held (ARCH §5), by either party', async () => {
      const offer = await publish(marta, 6);
      const a = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 2 });
      const b = await deps.reservations.create(pere, { offerId: offer.id, quantity: 1 });
      await deps.reservations.act(marta, a.reservation.id, 'confirm');
      await deps.reservations.act(marta, b.reservation.id, 'confirm');

      const byProducer = await deps.reservations.act(marta, a.reservation.id, 'deliver');
      expect(byProducer.reservation).toMatchObject({ status: 'delivered', closedBy: marta.id });
      expect(byProducer.reservation.deliveredAt).not.toBeNull();
      expect((await offerRow(offer.id)).quantity).toBe('4.00');
      expect((await deps.offers.mine(marta))[0]).toMatchObject({
        offer: { quantity: '4.00' },
        held: 1,
        available: 3,
        openReservations: 1,
      });
      expect((await queued('N8')).at(-1)).toMatchObject({
        memberId: jordi.id,
        payload: { decision: 'delivered', recipient: 'requester', actorName: 'Marta' },
      });

      const byRequester = await deps.reservations.act(pere, b.reservation.id, 'deliver');
      expect(byRequester.reservation.status).toBe('delivered');
      expect((await offerRow(offer.id)).quantity).toBe('3.00');
      expect((await queued('N8')).at(-1)).toMatchObject({
        memberId: marta.id,
        payload: { decision: 'delivered', recipient: 'producer', actorName: 'Pere' },
      });
      // The producer's board figure stays truthful: nothing held, three left.
      expect((await deps.offers.mine(marta))[0]).toMatchObject({ held: 0, available: 3 });
    });

    it('confirm-and-deliver leaves the same records as the two-step path, with one N8 (ADR-0014)', async () => {
      const offer = await publish(marta, 6);
      const twoStep = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 2 });
      const oneTap = await deps.reservations.create(pere, { offerId: offer.id, quantity: 1 });
      await deps.reservations.act(marta, twoStep.reservation.id, 'confirm');
      await deps.reservations.act(marta, twoStep.reservation.id, 'deliver');
      const before = (await queued('N8')).length;

      await expect(
        deps.reservations.act(jordi, oneTap.reservation.id, 'confirm-and-deliver'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const delivered = await deps.reservations.act(
        marta,
        oneTap.reservation.id,
        'confirm-and-deliver',
      );

      const [slow, fast] = [
        await reservationRow(twoStep.reservation.id),
        await reservationRow(oneTap.reservation.id),
      ];
      for (const row of [slow, fast]) {
        expect(row).toMatchObject({ status: 'delivered', expiresAt: null, closedBy: marta.id });
        expect(row.confirmedAt).not.toBeNull();
        expect(row.deliveredAt).not.toBeNull();
        expect(row.closedAt).not.toBeNull();
      }
      expect((await lines(oneTap.reservation.id)).map((l) => l.body)).toEqual([
        'created',
        'confirmed',
        'delivered',
      ]);
      expect((await lines(twoStep.reservation.id)).map((l) => l.body)).toEqual([
        'created',
        'confirmed',
        'delivered',
      ]);
      expect((await offerRow(offer.id)).quantity).toBe('3.00');
      expect(delivered.offerAvailable).toBe(3);
      const after = await queued('N8');
      expect(after).toHaveLength(before + 1);
      expect(after.at(-1)).toMatchObject({
        memberId: pere.id,
        payload: { decision: 'delivered', recipient: 'requester' },
      });
      await expect(
        deps.reservations.act(marta, oneTap.reservation.id, 'confirm-and-deliver'),
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });

    it('withdrawing an offer with open reservations sends N11 and keeps them actionable (US-3.2)', async () => {
      const offer = await publish(marta, 6);
      const a = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 2 });
      // A minute later, so the N11 list (ordered by creation) is deterministic under the fake clock.
      clock.now = new Date(NOW.getTime() + 60_000);
      const b = await deps.reservations.create(pere, { offerId: offer.id, quantity: 1 });
      await deps.offers.withdraw(marta, offer.id);
      expect(await queued('N11')).toMatchObject([
        {
          memberId: marta.id,
          payload: {
            offerId: offer.id,
            reservations: [
              { requesterName: 'Jordi', quantity: 2 },
              { requesterName: 'Pere', quantity: 1 },
            ],
          },
        },
      ]);
      // Nobody new can reserve it, but what is open stays a reservation with a lifecycle.
      await expect(
        deps.reservations.create(pere, { offerId: offer.id, quantity: 1 }),
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
      await deps.reservations.act(marta, a.reservation.id, 'confirm');
      await deps.reservations.act(marta, a.reservation.id, 'deliver');
      await deps.reservations.act(marta, b.reservation.id, 'reject');
      expect(await offerRow(offer.id)).toMatchObject({ status: 'withdrawn', quantity: '4.00' });
      const incoming = await deps.reservations.list(marta, { side: 'incoming', state: 'closed' });
      expect(incoming.map((r) => r.reservation.status).sort()).toEqual(['delivered', 'rejected']);
    });
  });

  describe('list and get (US-4.6)', () => {
    it('splits incoming/outgoing and active/closed, the closed tab covering the last 30 days', async () => {
      const offer = await publish(marta, 10);
      const mineToo = await publish(jordi, 10);
      const a = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 1 });
      const b = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 2 });
      const c = await deps.reservations.create(marta, { offerId: mineToo.id, quantity: 3 });
      const old = await deps.reservations.create(pere, { offerId: offer.id, quantity: 1 });
      await deps.reservations.act(marta, b.reservation.id, 'reject');
      await deps.reservations.act(marta, old.reservation.id, 'reject');
      await database!.db
        .update(reservations)
        .set({ closedAt: new Date(NOW.getTime() - 31 * 24 * HOUR) })
        .where(eq(reservations.id, old.reservation.id));

      const ids = (rows: Awaited<ReturnType<typeof deps.reservations.list>>) =>
        rows.map((r) => r.reservation.id);
      expect(
        ids(await deps.reservations.list(marta, { side: 'incoming', state: 'active' })),
      ).toEqual([a.reservation.id]);
      expect(
        ids(await deps.reservations.list(marta, { side: 'incoming', state: 'closed' })),
      ).toEqual([b.reservation.id]);
      expect(
        ids(await deps.reservations.list(marta, { side: 'outgoing', state: 'active' })),
      ).toEqual([c.reservation.id]);
      expect(
        ids(await deps.reservations.list(jordi, { side: 'outgoing', state: 'active' })),
      ).toEqual([a.reservation.id]);
      expect(
        ids(await deps.reservations.list(jordi, { side: 'incoming', state: 'active' })),
      ).toEqual([c.reservation.id]);
      expect(
        ids(await deps.reservations.list(pere, { side: 'outgoing', state: 'closed' })),
      ).toEqual([]);
      const detail = await deps.reservations.get(jordi, a.reservation.id);
      expect(detail.offerAvailable).toBe(9);
      expect(detail.producer.displayName).toBe('Marta');
    });

    it('a suspended member is refused, but their counterpart keeps seeing and closing the reservation (US-1.4)', async () => {
      const offer = await publish(marta, 6);
      const { reservation } = await deps.reservations.create(jordi, {
        offerId: offer.id,
        quantity: 2,
      });
      await database!.db
        .update(members)
        .set({ status: 'suspended' })
        .where(eq(members.id, jordi.id));
      await expect(deps.reservations.get(jordi, reservation.id)).rejects.toMatchObject({
        code: 'SUSPENDED',
      });
      expect(
        (await deps.reservations.list(marta, { side: 'incoming', state: 'active' })).map(
          (r) => r.reservation.id,
        ),
      ).toEqual([reservation.id]);
      await deps.reservations.act(marta, reservation.id, 'reject');
      expect((await reservationRow(reservation.id)).status).toBe('rejected');
    });
  });

  describe('catalogue rejection cascade (US-2.2, ADR-0018)', () => {
    it('cancels the open reservations with N8 to both sides before withdrawing the offers', async () => {
      const admin = await member(100, { role: 'admin', displayName: 'Admin' });
      const [pending] = await database!.db
        .insert(products)
        .values({
          slug: 'moniato',
          name: 'Moniato',
          unitCode: 'kg',
          priceCents: null,
          status: 'pending',
          source: 'member',
          proposedBy: marta.id,
        })
        .returning();
      const offer = await publish(marta, 10, pending!);
      const open = await deps.reservations.create(jordi, { offerId: offer.id, quantity: 2 });
      const done = await deps.reservations.create(pere, { offerId: offer.id, quantity: 1 });
      await deps.reservations.act(marta, done.reservation.id, 'confirm-and-deliver');
      deps.hub.published = [];

      await deps.catalog.reject(admin, pending!.id);

      expect(await reservationRow(open.reservation.id)).toMatchObject({
        status: 'cancelled',
        closedBy: admin.id,
        reason: null,
      });
      expect((await reservationRow(done.reservation.id)).status).toBe('delivered');
      expect((await lines(open.reservation.id)).at(-1)).toMatchObject({
        body: 'cancelled',
        meta: { event: 'cancelled', actorId: null, cause: 'product_rejected' },
      });
      expect((await offerRow(offer.id)).status).toBe('withdrawn');
      const n8 = (await queued('N8')).filter((n) => n.payload['cause'] === 'product_rejected');
      expect(n8.map((n) => n.memberId).sort()).toEqual([jordi.id, marta.id].sort());
      // N5 reaches the proposer (also the producer), not the requester: N8 already did.
      expect((await queued('N5')).map((n) => n.memberId)).toEqual([marta.id]);
      expect(deps.hub.published).toEqual([
        {
          memberIds: [jordi.id, marta.id],
          event: { type: 'reservation.changed', id: open.reservation.id },
        },
        expect.objectContaining({ event: { type: 'board.changed' } }),
      ]);
      const [archived] = await database!.db
        .select()
        .from(products)
        .where(eq(products.id, pending!.id));
      expect(archived).toMatchObject({ status: 'archived' });
    });
  });

  describe('concurrency (PRD principle 2)', () => {
    it('five members racing for the last unit: exactly one wins, the others learn what is left', async () => {
      const offer = await publish(marta, 1);
      const racers = await Promise.all([4, 5, 6, 7, 8].map((id) => member(id)));
      const outcomes = await Promise.allSettled(
        racers.map((racer) => deps.reservations.create(racer, { offerId: offer.id, quantity: 1 })),
      );
      const won = outcomes.filter((o) => o.status === 'fulfilled');
      const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(4);
      for (const { reason } of lost) {
        expect(reason).toMatchObject({
          code: 'INSUFFICIENT_AVAILABILITY',
          details: { available: 0 },
        });
      }
      const rows = await database!.db
        .select()
        .from(reservations)
        .where(and(eq(reservations.offerId, offer.id), eq(reservations.status, 'pending')));
      expect(rows).toHaveLength(1);
      expect((await deps.offers.mine(marta))[0]).toMatchObject({ held: 1, available: 0 });
    });
  });
});
