import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { SettingKey } from '@agrobot/shared';
import {
  members,
  messages,
  notifications,
  products,
  reservations,
  settings,
  type Member,
} from '../src/db/schema/index.js';
import { createOffersService } from '../src/domain/offers/service.js';
import { createReservationsService } from '../src/domain/reservations/service.js';
import { jobs } from '../src/jobs/index.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps, type TestDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

const T0 = new Date('2026-09-19T08:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let deps: TestDeps;
let marta: Member;
let jordi: Member;
let offerId: string;
const clock = { now: T0 };

suite('reservation deadline jobs with a fake clock (PRD US-4.5, ARCH §9)', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
    clock.now = T0;
    const base = testDeps(database!);
    const offersService = createOffersService({
      db: database!.db,
      hub: base.hub,
      now: () => clock.now,
    });
    const reservationsService = createReservationsService({
      db: database!.db,
      hub: base.hub,
      now: () => clock.now,
    });
    deps = {
      ...base,
      offers: offersService,
      reservations: reservationsService,
      jobDeps: {
        ...base.jobDeps,
        offers: offersService,
        reservations: reservationsService,
        now: () => clock.now,
      },
    };
    [marta, jordi] = (await database!.db
      .insert(members)
      .values([
        { telegramId: 1, displayName: 'Marta', status: 'approved' },
        { telegramId: 2, displayName: 'Jordi', status: 'approved', language: 'es' },
      ])
      .returning()) as [Member, Member];
    const [product] = await database!.db
      .insert(products)
      .values({ slug: 'ous', name: 'Ous', nameEs: 'Huevos', unitCode: 'dozen', priceCents: 300 })
      .returning();
    offerId = (await deps.offers.publish(marta, { productId: product!.id, quantity: 6 })).offer.id;
    deps.hub.wakes = 0;
    deps.hub.published = [];
  });

  afterAll(async () => {
    await database?.close();
  });

  const kind = (k: 'N7' | 'N8') =>
    database!.db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, k))
      .orderBy(asc(notifications.createdAt));
  const row = async (id: string) =>
    (await database!.db.select().from(reservations).where(eq(reservations.id, id)))[0]!;
  const runRemind = () => jobs['reservations.remind'].run(deps.jobDeps, undefined);
  const runExpire = () => jobs['reservations.expire'].run(deps.jobDeps, undefined);
  const setSetting = (key: SettingKey, value: number) =>
    database!.db.update(settings).set({ value }).where(eq(settings.key, key));

  it('reminds 12 h before the 48 h deadline, once, then expires at the deadline, releasing the quantity and telling both', async () => {
    const { reservation } = await deps.reservations.create(jordi, { offerId, quantity: 2 });
    const expiresAt = T0.getTime() + 48 * HOUR;

    // Nothing due yet: the jobs say when to come back (ARCH §9 deadline jobs).
    const early = await runRemind();
    expect(early.result).toEqual({ reminded: 0 });
    expect(early.nextDueAt?.getTime()).toBe(expiresAt - 12 * HOUR);
    const earlyExpire = await runExpire();
    expect(earlyExpire.result).toEqual({ expired: 0 });
    expect(earlyExpire.nextDueAt?.getTime()).toBe(expiresAt);
    expect(deps.hub.wakes).toBe(1); // the create

    clock.now = new Date(expiresAt - 12 * HOUR);
    const reminded = await runRemind();
    expect(reminded.result).toEqual({ reminded: 1 });
    expect(reminded.nextDueAt).toBeNull();
    expect((await row(reservation.id)).remindedAt?.getTime()).toBe(clock.now.getTime());
    expect(await kind('N7')).toMatchObject([
      {
        memberId: marta.id,
        payload: {
          reservationId: reservation.id,
          requesterName: 'Jordi',
          quantity: 2,
          expiresAt: new Date(expiresAt).toISOString(),
        },
      },
    ]);
    expect(deps.hub.wakes).toBe(2);
    // The alarm fires again: nothing new (at-least-once alarms, ADR-0017).
    expect((await runRemind()).result).toEqual({ reminded: 0 });
    expect(await kind('N7')).toHaveLength(1);

    clock.now = new Date(expiresAt - 1);
    expect((await runExpire()).result).toEqual({ expired: 0 });
    clock.now = new Date(expiresAt);
    deps.hub.published = [];
    const expired = await runExpire();
    expect(expired.result).toEqual({ expired: 1 });
    expect(expired.nextDueAt).toBeNull();
    expect(await row(reservation.id)).toMatchObject({ status: 'expired', closedBy: null });
    expect((await row(reservation.id)).closedAt?.getTime()).toBe(expiresAt);
    expect((await kind('N8')).map((n) => [n.memberId, n.payload['recipient']]).sort()).toEqual(
      [
        [jordi.id, 'requester'],
        [marta.id, 'producer'],
      ].sort(),
    );
    expect((await kind('N8')).every((n) => n.payload['decision'] === 'expired')).toBe(true);
    const lines = await database!.db
      .select()
      .from(messages)
      .where(eq(messages.reservationId, reservation.id))
      .orderBy(asc(messages.createdAt));
    expect(lines.map((l) => l.body)).toEqual(['created', 'expired']);
    // Released: the offer is whole again on every board; the parties see the change.
    expect((await deps.offers.mine(marta))[0]).toMatchObject({ held: 0, available: 6 });
    expect(deps.hub.published).toEqual([
      {
        memberIds: [jordi.id, marta.id],
        event: { type: 'reservation.changed', id: reservation.id },
      },
      expect.objectContaining({ event: { type: 'board.changed' } }),
    ]);
    expect((await runExpire()).result).toEqual({ expired: 0 });
    // Too late to confirm: the quick action is stale.
    await expect(deps.reservations.act(marta, reservation.id, 'confirm')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      details: { status: 'expired' },
    });
  });

  it('a 1-minute expiry (test setting) is reminded at once and expired a minute later; confirmed ones never expire', async () => {
    await setSetting('reservation_expiry_hours', 1 / 60);
    const { reservation: doomed } = await deps.reservations.create(jordi, { offerId, quantity: 1 });
    const { reservation: safe } = await deps.reservations.create(jordi, { offerId, quantity: 2 });
    await deps.reservations.act(marta, safe.id, 'confirm');

    // The reminder window (12 h) is wider than the whole life of the reservation.
    expect((await runRemind()).result).toEqual({ reminded: 1 });
    expect((await kind('N7'))[0]).toMatchObject({ payload: { reservationId: doomed.id } });

    clock.now = new Date(T0.getTime() + MINUTE);
    const outcome = await runExpire();
    expect(outcome.result).toEqual({ expired: 1 });
    expect((await row(doomed.id)).status).toBe('expired');
    expect((await row(safe.id)).status).toBe('confirmed');
    expect(outcome.nextDueAt).toBeNull();
    expect((await deps.offers.mine(marta))[0]).toMatchObject({ held: 2, available: 4 });
  });

  it('reads the reminder setting at run time and reports the next due from what remains', async () => {
    await setSetting('reservation_reminder_hours_before_expiry', 1);
    const first = await deps.reservations.create(jordi, { offerId, quantity: 1 });
    clock.now = new Date(T0.getTime() + HOUR);
    const second = await deps.reservations.create(jordi, { offerId, quantity: 1 });
    clock.now = new Date(T0.getTime() + 47 * HOUR);
    const outcome = await runRemind();
    expect(outcome.result).toEqual({ reminded: 1 });
    expect((await row(first.reservation.id)).remindedAt).not.toBeNull();
    expect((await row(second.reservation.id)).remindedAt).toBeNull();
    expect(outcome.nextDueAt?.getTime()).toBe(T0.getTime() + 48 * HOUR);
  });

  it('never reminds a reservation that has already reached its deadline', async () => {
    await setSetting('reservation_expiry_hours', 1 / 60);
    await setSetting('reservation_reminder_hours_before_expiry', 0);
    await deps.reservations.create(jordi, { offerId, quantity: 1 });
    clock.now = new Date(T0.getTime() + MINUTE);
    expect((await runRemind()).result).toEqual({ reminded: 0 });
    expect(await kind('N7')).toHaveLength(0);
    expect((await runExpire()).result).toEqual({ expired: 1 });
  });
});
