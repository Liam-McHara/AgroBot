import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  members,
  notifications,
  offers,
  products,
  reservations,
  settings,
  type Member,
} from '../src/db/schema/index.js';
import { createOffersService } from '../src/domain/offers/service.js';
import { jobs } from '../src/jobs/index.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps, type TestDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

const DAY = 86_400_000;
/** Publication instant: 10:00 in Madrid, 2026-09-01. */
const T0 = new Date('2026-09-01T08:00:00Z');

let deps: TestDeps;
let marta: Member;
let jordi: Member;
let productId: string;
const clock = { now: T0 };

suite('offer jobs with a fake clock (PRD US-3.4, ARCH §9)', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
    clock.now = T0;
    const base = testDeps(database!);
    const offersService = createOffersService({
      db: database!.db,
      hub: base.hub,
      now: () => clock.now,
    });
    deps = {
      ...base,
      offers: offersService,
      jobDeps: { ...base.jobDeps, offers: offersService, now: () => clock.now },
    };
    [marta, jordi] = (await database!.db
      .insert(members)
      .values([
        { telegramId: 1, displayName: 'Marta', status: 'approved' },
        { telegramId: 2, displayName: 'Jordi', status: 'approved' },
      ])
      .returning()) as [Member, Member];
    const [product] = await database!.db
      .insert(products)
      .values({ slug: 'ous', name: 'Ous', nameEs: 'Huevos', unitCode: 'dozen', priceCents: 300 })
      .returning();
    productId = product!.id;
  });

  afterAll(async () => {
    await database?.close();
  });

  const n10 = () => database!.db.select().from(notifications).where(eq(notifications.kind, 'N10'));
  const row = async (id: string) =>
    (await database!.db.select().from(offers).where(eq(offers.id, id)))[0]!;
  const runNudge = () => jobs['offers.nudge'].run(deps.jobDeps, undefined);
  const runExpire = () => jobs['offers.expire'].run(deps.jobDeps, undefined);

  describe('offers.expire', () => {
    it('expires offers whose date is before today on the farm, and nothing else', async () => {
      const { offer: yesterday } = await deps.offers.publish(marta, {
        productId,
        quantity: 1,
        availableUntil: '2026-09-01',
      });
      const [other] = await database!.db
        .insert(products)
        .values({ slug: 'pomes', name: 'Pomes', unitCode: 'kg', priceCents: 100 })
        .returning();
      const { offer: today } = await deps.offers.publish(marta, {
        productId: other!.id,
        quantity: 1,
        availableUntil: '2026-09-02',
      });
      const { offer: dateless } = await deps.offers.publish(jordi, { productId, quantity: 1 });
      const { offer: withdrawn } = await deps.offers.publish(jordi, {
        productId: other!.id,
        quantity: 1,
        availableUntil: '2026-09-01',
      });
      await deps.offers.withdraw(jordi, withdrawn.id);
      const published = deps.hub.published.length;

      // 00:05 on 2026-09-02 in Madrid is 22:05 UTC the evening before: still 09-01 in UTC.
      clock.now = new Date('2026-09-01T22:05:00Z');
      const outcome = await runExpire();
      expect(outcome.result).toEqual({ expired: 1 });
      expect((await row(yesterday.id)).status).toBe('expired');
      expect((await row(today.id)).status).toBe('active');
      expect((await row(dateless.id)).status).toBe('active');
      expect((await row(withdrawn.id)).status).toBe('withdrawn');
      // ARCH §7: boards refetch once; ARCH §9: next run at 00:05 Madrid the next night.
      expect(deps.hub.published).toHaveLength(published + 1);
      expect(outcome.nextDueAt?.toISOString()).toBe('2026-09-02T22:05:00.000Z');

      // Idempotent: the next run finds nothing and tells nobody.
      expect((await runExpire()).result).toEqual({ expired: 0 });
      expect(deps.hub.published).toHaveLength(published + 1);
    });
  });

  describe('offers.nudge', () => {
    it('nudges after 7 idle days, marks stale 3 days later, re-nudges weekly, and stops on an answer', async () => {
      const { offer } = await deps.offers.publish(marta, { productId, quantity: 4 });
      const at = (days: number, hour = 7) =>
        new Date(T0.getTime() + days * DAY + (hour - 8) * 3_600_000);

      clock.now = at(6);
      expect((await runNudge()).result).toEqual({ nudged: 0, stale: 0, renudged: 0 });
      expect(await n10()).toHaveLength(0);

      clock.now = at(7, 9);
      const first = await runNudge();
      expect(first.result).toEqual({ nudged: 1, stale: 0, renudged: 0 });
      expect(first.nextDueAt?.toISOString()).toBe('2026-09-09T07:00:00.000Z');
      expect(await n10()).toMatchObject([
        {
          memberId: marta.id,
          payload: { offerId: offer.id, productName: 'Ous', unitCode: 'dozen', quantity: 4 },
        },
      ]);
      expect((await row(offer.id)).nudgedAt?.getTime()).toBe(clock.now.getTime());
      expect(deps.hub.wakes).toBe(2); // N3 at publish, N10 now

      // The alarm fires again the same morning: nothing new (at-least-once alarms).
      expect((await runNudge()).result).toEqual({ nudged: 0, stale: 0, renudged: 0 });
      clock.now = at(9);
      expect((await runNudge()).result).toEqual({ nudged: 0, stale: 0, renudged: 0 });

      const published = deps.hub.published.length;
      clock.now = at(10, 9);
      expect((await runNudge()).result).toEqual({ nudged: 0, stale: 1, renudged: 0 });
      expect((await row(offer.id)).stale).toBe(true);
      expect(await n10()).toHaveLength(1);
      // The badge appeared: boards refetch; no notification, so no wake.
      expect(deps.hub.published).toHaveLength(published + 1);
      expect(deps.hub.wakes).toBe(2);

      clock.now = at(13, 9);
      expect((await runNudge()).result).toEqual({ nudged: 0, stale: 0, renudged: 0 });
      clock.now = at(14, 9);
      expect((await runNudge()).result).toEqual({ nudged: 0, stale: 0, renudged: 1 });
      expect(await n10()).toHaveLength(2);
      expect(await row(offer.id)).toMatchObject({ stale: true });
      clock.now = at(21, 9);
      expect((await runNudge()).result).toEqual({ nudged: 0, stale: 0, renudged: 1 });
      expect(await n10()).toHaveLength(3);

      // "Yes, still available" resets the whole cycle.
      await deps.offers.stillAvailable(marta, offer.id);
      expect(await row(offer.id)).toMatchObject({ stale: false, nudgedAt: null });
      clock.now = at(27, 9);
      expect((await runNudge()).result).toEqual({ nudged: 0, stale: 0, renudged: 0 });
      clock.now = at(28, 9);
      expect((await runNudge()).result).toEqual({ nudged: 1, stale: 0, renudged: 0 });
    });

    it('leaves dated, fully held, withdrawn and suspended producers’ offers alone, and reads the settings', async () => {
      const [pere] = await database!.db
        .insert(members)
        .values({ telegramId: 3, displayName: 'Pere', status: 'approved' })
        .returning();
      const others = await database!.db
        .insert(products)
        .values([
          { slug: 'a', name: 'A', unitCode: 'kg', priceCents: 1 },
          { slug: 'b', name: 'B', unitCode: 'kg', priceCents: 1 },
          { slug: 'c', name: 'C', unitCode: 'kg', priceCents: 1 },
        ])
        .returning();
      const { offer: dated } = await deps.offers.publish(marta, {
        productId,
        quantity: 1,
        availableUntil: '2027-01-01',
      });
      const { offer: held } = await deps.offers.publish(marta, {
        productId: others[0]!.id,
        quantity: 2,
      });
      await database!.db.insert(reservations).values({
        offerId: held.id,
        requesterId: jordi.id,
        producerId: marta.id,
        quantity: '2',
        status: 'confirmed',
      });
      const { offer: gone } = await deps.offers.publish(marta, {
        productId: others[1]!.id,
        quantity: 2,
      });
      await deps.offers.withdraw(marta, gone.id);
      const { offer: suspended } = await deps.offers.publish(pere!, { productId, quantity: 2 });
      await database!.db
        .update(members)
        .set({ status: 'suspended' })
        .where(eq(members.id, pere!.id));
      const { offer: live } = await deps.offers.publish(jordi, {
        productId: others[2]!.id,
        quantity: 2,
      });

      clock.now = new Date(T0.getTime() + 30 * DAY);
      expect((await runNudge()).result).toEqual({ nudged: 1, stale: 0, renudged: 0 });
      expect((await n10()).map((n) => n.payload)).toMatchObject([{ offerId: live.id }]);
      for (const untouched of [dated, held, gone, suspended]) {
        expect((await row(untouched.id)).nudgedAt).toBeNull();
      }

      // A shorter patience, set by an admin, applies at the next run without a restart.
      await database!.db
        .update(settings)
        .set({ value: 1 })
        .where(eq(settings.key, 'offer_nudge_days'));
      await database!.db
        .update(settings)
        .set({ value: 1 })
        .where(eq(settings.key, 'offer_stale_days_after_nudge'));
      const { offer: fresh } = await deps.offers.publish(marta, {
        productId: others[1]!.id,
        quantity: 2,
      });
      clock.now = new Date(clock.now.getTime() + DAY);
      expect((await runNudge()).result).toEqual({ nudged: 1, stale: 1, renudged: 0 });
      expect((await row(fresh.id)).nudgedAt).not.toBeNull();
      expect((await row(live.id)).stale).toBe(true);
    });
  });
});
