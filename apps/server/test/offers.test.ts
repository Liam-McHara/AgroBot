import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { NotificationKind } from '@agrobot/shared';
import {
  members,
  notifications,
  offers,
  products,
  reservations,
  settings,
  type Member,
  type Product,
} from '../src/db/schema/index.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps, type TestDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

/** The farm's calendar for these tests: a fixed instant, 10:00 in Madrid on 2026-09-19. */
const NOW = new Date('2026-09-19T08:00:00Z');
const TODAY = '2026-09-19';
const YESTERDAY = '2026-09-18';
const TOMORROW = '2026-09-20';

let deps: TestDeps;
let marta: Member;
let jordi: Member;
let pere: Member;
let tomato: Product;
let eggs: Product;

const clock = { now: NOW };

async function member(telegramId: number, over: Partial<typeof members.$inferInsert> = {}) {
  const [row] = await database!.db
    .insert(members)
    .values({ telegramId, displayName: `Member ${telegramId}`, status: 'approved', ...over })
    .returning();
  return row!;
}

async function product(slug: string, over: Partial<typeof products.$inferInsert> = {}) {
  const [row] = await database!.db
    .insert(products)
    .values({ slug, name: slug, unitCode: 'kg', priceCents: 200, ...over })
    .returning();
  return row!;
}

const queued = (kind: NotificationKind) =>
  database!.db.select().from(notifications).where(eq(notifications.kind, kind));

/** Every approved member: the three of this file plus the two seeded dev members (ARCH §14). */
const approvedIds = async () =>
  (
    await database!.db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.status, 'approved'))
  )
    .map((row) => row.id)
    .sort();
/** N3 recipients of one publish: every approved member but the producer. */
let OTHERS = 0;

async function hold(offerId: string, requester: Member, quantity: number, status = 'pending') {
  const [offer] = await database!.db.select().from(offers).where(eq(offers.id, offerId));
  await database!.db.insert(reservations).values({
    offerId,
    requesterId: requester.id,
    producerId: offer!.producerId,
    quantity: String(quantity),
    unitPriceCents: 200,
    status: status as 'pending',
    expiresAt: status === 'pending' ? new Date(clock.now.getTime() + 3_600_000) : null,
  });
}

suite('offers and the board: real Postgres (PRD §7)', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
    clock.now = NOW;
    deps = testDeps(database!);
    // The service under test reads the fake clock; the hub recorder comes from testDeps.
    deps = {
      ...deps,
      offers: (await import('../src/domain/offers/service.js')).createOffersService({
        db: database!.db,
        hub: deps.hub,
        now: () => clock.now,
      }),
    };
    marta = await member(1, { displayName: 'Marta', language: 'ca' });
    jordi = await member(2, { displayName: 'Jordi', language: 'es' });
    pere = await member(3, { displayName: 'Pere' });
    await member(4, { displayName: 'Applicant', status: 'pending' });
    await member(5, { displayName: 'Suspended', status: 'suspended' });
    tomato = await product('tomaquet', { name: 'Tomàquet', nameEs: 'Tomate', category: 'Horta' });
    eggs = await product('ous', { name: 'Ous', unitCode: 'dozen', priceCents: 350 });
    OTHERS = (await approvedIds()).length - 1;
  });

  afterAll(async () => {
    await database?.close();
  });

  describe('publish (US-3.1)', () => {
    it('creates an active offer and tells every other approved member (N3), then wakes the hub', async () => {
      const record = await deps.offers.publish(marta, {
        productId: tomato.id,
        quantity: 12.5,
        availableUntil: TOMORROW,
        note: 'Collits avui',
      });
      expect(record).toMatchObject({
        available: 12.5,
        held: 0,
        openReservations: 0,
        producer: { id: marta.id, displayName: 'Marta' },
        product: { id: tomato.id },
      });
      expect(record.offer).toMatchObject({
        status: 'active',
        quantity: '12.50',
        availableUntil: TOMORROW,
        note: 'Collits avui',
        stale: false,
        nudgedAt: null,
      });
      expect(record.offer.lastActivityAt.getTime()).toBe(NOW.getTime());

      const n3 = await queued('N3');
      expect(n3.map((n) => n.memberId).sort()).toEqual(
        (await approvedIds()).filter((id) => id !== marta.id),
      );
      expect(n3).toHaveLength(OTHERS);
      expect(n3[0]?.payload).toEqual({
        offerId: record.offer.id,
        productName: 'Tomàquet',
        productNameEs: 'Tomate',
        unitCode: 'kg',
        producerName: 'Marta',
        quantity: 12.5,
        republished: false,
      });
      expect(deps.hub.wakes).toBe(1);
      // ARCH §7: every approved member's board refetches, the producer's own list included.
      expect(deps.hub.published).toHaveLength(1);
      expect(deps.hub.published[0]).toMatchObject({ event: { type: 'board.changed' } });
      expect([...deps.hub.published[0]!.memberIds].sort()).toEqual(await approvedIds());
    });

    it('stays quiet when the group turned notify_new_offer off', async () => {
      await database!.db
        .update(settings)
        .set({ value: false })
        .where(eq(settings.key, 'notify_new_offer'));
      await deps.offers.publish(marta, { productId: tomato.id, quantity: 1 });
      expect(await queued('N3')).toHaveLength(0);
      expect(deps.hub.wakes).toBe(0);
      expect(deps.hub.published).toHaveLength(1);
    });

    it('validates the quantity step per unit and the date against the farm calendar', async () => {
      await expect(
        deps.offers.publish(marta, { productId: tomato.id, quantity: 2.55 }),
      ).rejects.toMatchObject({ code: 'VALIDATION', details: { quantity: 'step' } });
      await expect(
        deps.offers.publish(marta, { productId: eggs.id, quantity: 2.5 }),
      ).rejects.toMatchObject({ code: 'VALIDATION', details: { quantity: 'step' } });
      await expect(
        deps.offers.publish(marta, { productId: tomato.id, quantity: 0 }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        deps.offers.publish(marta, {
          productId: tomato.id,
          quantity: 1,
          availableUntil: YESTERDAY,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION', details: { availableUntil: 'past' } });
      // Today on the farm is fine, even though it is already tomorrow east of Madrid.
      const today = await deps.offers.publish(marta, {
        productId: tomato.id,
        quantity: 1,
        availableUntil: TODAY,
      });
      expect(today.offer.availableUntil).toBe(TODAY);
      expect(await database!.db.select().from(offers)).toHaveLength(1);
    });

    it('offers active products and my own pending ones, nothing else', async () => {
      const archived = await product('arxivat', { status: 'archived' });
      const mine = await product('meu', {
        status: 'pending',
        source: 'member',
        proposedBy: marta.id,
        priceCents: null,
      });
      const theirs = await product('seu', {
        status: 'pending',
        source: 'member',
        proposedBy: jordi.id,
        priceCents: null,
      });
      await expect(
        deps.offers.publish(marta, { productId: archived.id, quantity: 1 }),
      ).rejects.toMatchObject({ code: 'VALIDATION', details: { productId: 'not_offerable' } });
      await expect(
        deps.offers.publish(marta, { productId: theirs.id, quantity: 1 }),
      ).rejects.toMatchObject({ code: 'VALIDATION', details: { productId: 'not_offerable' } });
      await expect(
        deps.offers.publish(marta, {
          productId: '00000000-0000-4000-8000-000000000000',
          quantity: 1,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const pending = await deps.offers.publish(marta, { productId: mine.id, quantity: 3 });
      expect(pending.product.priceCents).toBeNull();
    });

    it('answers OFFER_ALREADY_ACTIVE with the existing offer, also under concurrency', async () => {
      const first = await deps.offers.publish(marta, { productId: tomato.id, quantity: 1 });
      await expect(
        deps.offers.publish(marta, { productId: tomato.id, quantity: 2 }),
      ).rejects.toMatchObject({
        code: 'OFFER_ALREADY_ACTIVE',
        details: { offerId: first.offer.id },
      });
      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          deps.offers.publish(jordi, { productId: eggs.id, quantity: 1 }),
        ),
      );
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(
        outcomes.filter(
          (o) =>
            o.status === 'rejected' &&
            (o.reason as { code: string }).code === 'OFFER_ALREADY_ACTIVE',
        ),
      ).toHaveLength(3);
      // Another producer may offer the same product.
      await deps.offers.publish(pere, { productId: tomato.id, quantity: 5 });
    });

    it('is closed to applicants and suspended members, checked against the row', async () => {
      const applicant = (
        await database!.db.select().from(members).where(eq(members.telegramId, 4))
      )[0]!;
      await expect(
        deps.offers.publish(applicant, { productId: tomato.id, quantity: 1 }),
      ).rejects.toMatchObject({ code: 'NOT_APPROVED' });
      await database!.db
        .update(members)
        .set({ status: 'suspended' })
        .where(eq(members.id, marta.id));
      await expect(
        deps.offers.publish(marta, { productId: tomato.id, quantity: 1 }),
      ).rejects.toMatchObject({ code: 'SUSPENDED' });
    });
  });

  describe('edit (US-3.2)', () => {
    it('changes quantity, date and note, resets the nudge cycle, and refuses non-producers', async () => {
      const { offer } = await deps.offers.publish(marta, { productId: tomato.id, quantity: 10 });
      await database!.db
        .update(offers)
        .set({ stale: true, nudgedAt: NOW, lastActivityAt: new Date('2026-09-01T00:00:00Z') })
        .where(eq(offers.id, offer.id));
      clock.now = new Date(NOW.getTime() + 60_000);
      const edited = await deps.offers.edit(marta, offer.id, {
        quantity: 8,
        availableUntil: TOMORROW,
        note: 'Millor al matí',
      });
      expect(edited.offer).toMatchObject({
        quantity: '8.00',
        availableUntil: TOMORROW,
        note: 'Millor al matí',
        status: 'active',
        stale: false,
        nudgedAt: null,
      });
      expect(edited.offer.lastActivityAt.getTime()).toBe(clock.now.getTime());
      const cleared = await deps.offers.edit(marta, offer.id, { availableUntil: null, note: null });
      expect(cleared.offer).toMatchObject({ availableUntil: null, note: null });
      // A plain edit of a visible offer is not a re-publish.
      expect(await queued('N3')).toHaveLength(OTHERS);
      await expect(deps.offers.edit(jordi, offer.id, { quantity: 1 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(deps.offers.edit(marta, offer.id, {})).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(
        deps.offers.edit(marta, '00000000-0000-4000-8000-000000000000', { quantity: 1 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('lowers quantity down to what is held and no further (OFFER_QUANTITY_BELOW_HELD)', async () => {
      const { offer } = await deps.offers.publish(marta, { productId: tomato.id, quantity: 10 });
      await hold(offer.id, jordi, 2.5, 'pending');
      await hold(offer.id, pere, 1, 'confirmed');
      await hold(offer.id, pere, 4, 'cancelled');
      const held = await deps.offers.edit(marta, offer.id, { quantity: 3.5 });
      expect(held).toMatchObject({ held: 3.5, available: 0, openReservations: 2 });
      await expect(deps.offers.edit(marta, offer.id, { quantity: 3.4 })).rejects.toMatchObject({
        code: 'OFFER_QUANTITY_BELOW_HELD',
        params: { held: 3.5 },
        details: { held: 3.5 },
      });
      // Nothing held: down to zero is allowed, and the offer leaves the board.
      const { offer: free } = await deps.offers.publish(marta, { productId: eggs.id, quantity: 4 });
      expect((await deps.offers.edit(marta, free.id, { quantity: 0 })).available).toBe(0);
      const board = await deps.offers.board(jordi, { group: 'product', q: '', category: '' });
      expect(board.groups.map((g) => g.name)).toEqual([]);
    });

    it('re-publishes (N3 again) when an edit puts the offer back on the board', async () => {
      const { offer } = await deps.offers.publish(marta, { productId: tomato.id, quantity: 10 });
      expect(await queued('N3')).toHaveLength(OTHERS);
      await deps.offers.edit(marta, offer.id, { quantity: 0 });
      expect(await queued('N3')).toHaveLength(OTHERS);
      await deps.offers.edit(marta, offer.id, { quantity: 6 });
      const n3 = await queued('N3');
      expect(n3).toHaveLength(2 * OTHERS);
      expect(n3.at(-1)?.payload).toMatchObject({ republished: true, quantity: 6 });
      expect(deps.hub.wakes).toBe(2);

      // Fully held, then raised above the hold: back on the board, announced again.
      await hold(offer.id, jordi, 6, 'confirmed');
      await deps.offers.edit(marta, offer.id, { note: 'encara res' });
      expect(await queued('N3')).toHaveLength(2 * OTHERS);
      await deps.offers.edit(marta, offer.id, { quantity: 7 });
      expect(await queued('N3')).toHaveLength(3 * OTHERS);
    });

    it('brings an expired offer back with a new date and a withdrawn one with any edit', async () => {
      const { offer: expired } = await deps.offers.publish(marta, {
        productId: tomato.id,
        quantity: 3,
        availableUntil: TODAY,
      });
      await database!.db.update(offers).set({ status: 'expired' }).where(eq(offers.id, expired.id));
      clock.now = new Date('2026-09-20T08:00:00Z');
      // A note edit on a day the date has passed keeps it expired: the calendar decides.
      expect((await deps.offers.edit(marta, expired.id, { note: 'x' })).offer.status).toBe(
        'expired',
      );
      expect(await queued('N3')).toHaveLength(OTHERS);
      const back = await deps.offers.edit(marta, expired.id, { availableUntil: '2026-09-25' });
      expect(back.offer.status).toBe('active');
      expect(await queued('N3')).toHaveLength(2 * OTHERS);

      const withdrawn = await deps.offers.withdraw(marta, back.offer.id);
      expect(withdrawn.offer.status).toBe('withdrawn');
      const again = await deps.offers.edit(marta, withdrawn.offer.id, { quantity: 4 });
      expect(again.offer.status).toBe('active');
      expect((await queued('N3')).at(-1)?.payload).toMatchObject({
        republished: true,
        quantity: 4,
      });

      // Re-activation respects one active offer per product.
      await deps.offers.withdraw(marta, again.offer.id);
      const fresh = await deps.offers.publish(marta, { productId: tomato.id, quantity: 1 });
      await expect(deps.offers.edit(marta, again.offer.id, { quantity: 2 })).rejects.toMatchObject({
        code: 'OFFER_ALREADY_ACTIVE',
        details: { offerId: fresh.offer.id },
      });
    });
  });

  describe('withdraw and still-available (US-3.2, US-3.4)', () => {
    it('hides the offer, reminds the producer of open reservations (N11) once, and refuses a repeat', async () => {
      const { offer } = await deps.offers.publish(marta, { productId: tomato.id, quantity: 10 });
      await hold(offer.id, jordi, 2, 'pending');
      await hold(offer.id, pere, 3.5, 'confirmed');
      await hold(offer.id, pere, 1, 'rejected');
      const withdrawn = await deps.offers.withdraw(marta, offer.id);
      expect(withdrawn.offer.status).toBe('withdrawn');
      const [n11] = await queued('N11');
      expect(n11).toMatchObject({
        memberId: marta.id,
        payload: {
          offerId: offer.id,
          productName: 'Tomàquet',
          unitCode: 'kg',
          reservations: [
            { requesterName: 'Jordi', quantity: 2 },
            { requesterName: 'Pere', quantity: 3.5 },
          ],
        },
      });
      expect(deps.hub.wakes).toBe(2);
      expect(await deps.offers.mine(marta)).toHaveLength(0);
      await expect(deps.offers.withdraw(marta, offer.id)).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });
      await expect(deps.offers.withdraw(jordi, offer.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('sends no N11 without open reservations and lets an expired offer be withdrawn', async () => {
      const { offer } = await deps.offers.publish(marta, { productId: tomato.id, quantity: 10 });
      await database!.db.update(offers).set({ status: 'expired' }).where(eq(offers.id, offer.id));
      expect((await deps.offers.withdraw(marta, offer.id)).offer.status).toBe('withdrawn');
      expect(await queued('N11')).toHaveLength(0);
    });

    it('still-available clears the stale mark and the nudge, only on active offers', async () => {
      const { offer } = await deps.offers.publish(marta, { productId: tomato.id, quantity: 10 });
      await database!.db
        .update(offers)
        .set({ stale: true, nudgedAt: NOW, lastActivityAt: new Date('2026-09-01T00:00:00Z') })
        .where(eq(offers.id, offer.id));
      clock.now = new Date(NOW.getTime() + 5_000);
      const published = deps.hub.published.length;
      const fresh = await deps.offers.stillAvailable(marta, offer.id);
      expect(fresh.offer).toMatchObject({ stale: false, nudgedAt: null });
      expect(fresh.offer.lastActivityAt.getTime()).toBe(clock.now.getTime());
      expect(deps.hub.published).toHaveLength(published + 1);
      // Nothing visible changed the second time: no board refetch for anyone.
      await deps.offers.stillAvailable(marta, offer.id);
      expect(deps.hub.published).toHaveLength(published + 1);
      await expect(deps.offers.stillAvailable(jordi, offer.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await deps.offers.withdraw(marta, offer.id);
      await expect(deps.offers.stillAvailable(marta, offer.id)).rejects.toMatchObject({
        code: 'INVALID_TRANSITION',
      });
    });
  });

  describe('board and my offers (US-3.3, US-3.4)', () => {
    const boardFor = (
      viewer: Member,
      over: Partial<{ group: 'product' | 'producer'; q: string; category: string }> = {},
    ) => deps.offers.board(viewer, { group: 'product', q: '', category: '', ...over });

    it('shows other approved members’ reservable offers only', async () => {
      const suspended = (
        await database!.db.select().from(members).where(eq(members.telegramId, 5))
      )[0]!;
      const { offer: mine } = await deps.offers.publish(marta, {
        productId: tomato.id,
        quantity: 5,
      });
      await deps.offers.publish(jordi, { productId: tomato.id, quantity: 3 });
      const { offer: fullyHeld } = await deps.offers.publish(jordi, {
        productId: eggs.id,
        quantity: 2,
      });
      await hold(fullyHeld.id, pere, 2, 'confirmed');
      const { offer: expired } = await deps.offers.publish(pere, {
        productId: eggs.id,
        quantity: 2,
        availableUntil: TODAY,
      });
      await database!.db
        .update(offers)
        .set({ status: 'expired', availableUntil: YESTERDAY })
        .where(eq(offers.id, expired.id));
      // A date that passed but a job that has not run yet: still hidden by the date rule.
      const { offer: pastDate } = await deps.offers.publish(pere, {
        productId: tomato.id,
        quantity: 2,
        availableUntil: TODAY,
      });
      await database!.db
        .update(offers)
        .set({ availableUntil: YESTERDAY })
        .where(eq(offers.id, pastDate.id));
      const { offer: withdrawn } = await deps.offers.publish(marta, {
        productId: eggs.id,
        quantity: 2,
      });
      await deps.offers.withdraw(marta, withdrawn.id);
      // A suspended producer's offers are hidden (US-1.4).
      await database!.db.insert(offers).values({
        producerId: suspended.id,
        productId: tomato.id,
        quantity: '9',
      });

      const board = await boardFor(marta);
      expect(board.total).toBe(1);
      expect(board.groups).toHaveLength(1);
      expect(board.groups[0]).toMatchObject({ key: tomato.id, name: 'Tomàquet', nameEs: 'Tomate' });
      expect(board.groups[0]!.offers.map((o) => [o.producer.displayName, o.available])).toEqual([
        ['Jordi', 3],
      ]);
      expect(board.categories).toEqual(['Horta']);
      // My own offer is in *My offers*, not on my board (US-3.3).
      expect((await deps.offers.mine(marta)).map((o) => o.offer.id)).toEqual([mine.id]);
      // Others see it, with the rest that is visible to them.
      const forPere = await boardFor(pere);
      expect(forPere.groups[0]!.offers.map((o) => o.producer.displayName)).toEqual([
        'Jordi',
        'Marta',
      ]);
    });

    it('groups by product or producer, searches both languages and producers, filters by category', async () => {
      const carrot = await product('pastanaga', {
        name: 'Pastanaga',
        nameEs: 'Zanahoria',
        category: 'Horta',
      });
      await deps.offers.publish(jordi, { productId: tomato.id, quantity: 3 });
      await deps.offers.publish(pere, { productId: tomato.id, quantity: 4 });
      await deps.offers.publish(pere, { productId: eggs.id, quantity: 4 });
      await deps.offers.publish(jordi, { productId: carrot.id, quantity: 1 });

      const byProduct = await boardFor(marta);
      expect(
        byProduct.groups.map((g) => [g.name, g.offers.map((o) => o.producer.displayName)]),
      ).toEqual([
        ['Ous', ['Pere']],
        ['Pastanaga', ['Jordi']],
        ['Tomàquet', ['Jordi', 'Pere']],
      ]);
      expect(byProduct.categories).toEqual(['Horta']);
      expect(byProduct.total).toBe(4);

      const byProducer = await boardFor(marta, { group: 'producer' });
      expect(
        byProducer.groups.map((g) => [g.name, g.nameEs, g.offers.map((o) => o.product.name)]),
      ).toEqual([
        ['Jordi', null, ['Pastanaga', 'Tomàquet']],
        ['Pere', null, ['Ous', 'Tomàquet']],
      ]);

      expect((await boardFor(marta, { q: 'zanahoria' })).groups.map((g) => g.name)).toEqual([
        'Pastanaga',
      ]);
      expect((await boardFor(marta, { q: 'TOMAQUET' })).total).toBe(2);
      expect((await boardFor(marta, { q: 'pere' })).total).toBe(2);
      const horta = await boardFor(marta, { category: 'Horta' });
      expect(horta.groups.map((g) => g.name)).toEqual(['Pastanaga', 'Tomàquet']);
      // The chips list every category on the board, even when one is selected.
      expect(horta.categories).toEqual(['Horta']);
      expect((await boardFor(marta, { category: 'Fruita' })).total).toBe(0);
    });

    it('sorts stale offers last (US-3.4)', async () => {
      const { offer: staleOne } = await deps.offers.publish(jordi, {
        productId: eggs.id,
        quantity: 3,
      });
      await deps.offers.publish(pere, { productId: tomato.id, quantity: 4 });
      await database!.db.update(offers).set({ stale: true }).where(eq(offers.id, staleOne.id));
      const board = await boardFor(marta, { group: 'producer' });
      expect(board.groups.map((g) => [g.name, g.offers[0]!.stale])).toEqual([
        ['Pere', false],
        ['Jordi', true],
      ]);
    });

    it('my offers lists active and expired ones with held and available, newest product first within a status', async () => {
      const { offer: a } = await deps.offers.publish(marta, { productId: tomato.id, quantity: 10 });
      const { offer: b } = await deps.offers.publish(marta, { productId: eggs.id, quantity: 2 });
      await hold(a.id, jordi, 4, 'pending');
      await database!.db.update(offers).set({ status: 'expired' }).where(eq(offers.id, b.id));
      const mine = await deps.offers.mine(marta);
      expect(
        mine.map((o) => [o.product.name, o.offer.status, o.held, o.available, o.openReservations]),
      ).toEqual([
        ['Tomàquet', 'active', 4, 6, 1],
        ['Ous', 'expired', 0, 2, 0],
      ]);
      expect(await deps.offers.mine(jordi)).toEqual([]);
    });

    it('keeps one active offer per producer and product at the database level too', async () => {
      await database!.db
        .insert(offers)
        .values({ producerId: marta.id, productId: tomato.id, quantity: '1' });
      await expect(
        database!.db
          .insert(offers)
          .values({ producerId: marta.id, productId: tomato.id, quantity: '2' }),
      ).rejects.toThrow();
      await database!.db
        .insert(offers)
        .values({ producerId: marta.id, productId: tomato.id, quantity: '2', status: 'withdrawn' });
      expect(
        await database!.db
          .select()
          .from(offers)
          .where(and(eq(offers.producerId, marta.id), eq(offers.productId, tomato.id))),
      ).toHaveLength(2);
    });

    it('get: any member may open any offer by id, except one of a suspended producer', async () => {
      const { offer } = await deps.offers.publish(marta, { productId: tomato.id, quantity: 10 });
      await deps.offers.withdraw(marta, offer.id);
      expect((await deps.offers.get(jordi, offer.id)).offer.status).toBe('withdrawn');
      await database!.db
        .update(members)
        .set({ status: 'suspended' })
        .where(eq(members.id, marta.id));
      await expect(deps.offers.get(jordi, offer.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        deps.offers.get(jordi, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
