import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_SETTINGS } from '@agrobot/shared';
import { members, settings, products, notifications } from '../src/db/schema/index.js';
import { createSettingsService, loadSettings } from '../src/domain/settings/service.js';
import { createApp } from '../src/http/app.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;
suite('settings domain and API (PRD US-7.1)', () => {
  let deps: ReturnType<typeof testDeps>;
  beforeEach(async () => {
    await resetDatabase(database!);
    deps = testDeps(database!, { DEV_AUTH_BYPASS_TELEGRAM_ID: '900000001' });
    await database!.db
      .update(members)
      .set({ role: 'admin' })
      .where(eq(members.telegramId, 900000001));
  });
  afterAll(async () => {
    await database?.close();
  });
  const actor = async () =>
    (await database!.db.select().from(members).where(eq(members.telegramId, 900000001)))[0]!;
  const call = (method: string, body?: unknown, id = '900000001') =>
    createApp(deps).request('/api/admin/settings', {
      method,
      headers: { authorization: `dev ${id}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('requires admin on reads and writes, including a stale domain actor', async () => {
    expect((await call('GET', undefined, '900000002')).status).toBe(403);
    expect((await call('PATCH', { notify_new_offer: false }, '900000002')).status).toBe(403);
    const admin = await actor();
    await database!.db.update(members).set({ role: 'member' }).where(eq(members.id, admin.id));
    const service = createSettingsService(deps);
    await expect(service.get(admin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update(admin, { notify_new_offer: false })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(deps.hub.wakes).toBe(0);
  });
  it('validates the entire patch atomically and records who changed each key', async () => {
    expect(await (await call('GET')).json()).toEqual(DEFAULT_SETTINGS);
    for (const body of [{}, { unknown: 1 }, { notify_new_offer: false, offer_nudge_days: 0 }]) {
      expect((await call('PATCH', body)).status).toBe(400);
    }
    expect(await loadSettings(database!.db)).toEqual(DEFAULT_SETTINGS);
    const response = await call('PATCH', {
      notify_new_offer: false,
      reservation_reminder_hours_before_expiry: 24,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...DEFAULT_SETTINGS,
      notify_new_offer: false,
      reservation_reminder_hours_before_expiry: 24,
    });
    const [row] = await database!.db
      .select()
      .from(settings)
      .where(eq(settings.key, 'notify_new_offer'));
    expect(row!.updatedBy).toBe((await actor()).id);
    expect(deps.hub.wakes).toBe(1);
  });
  it('uses updates on the next publication and reservation without moving an existing expiry', async () => {
    const producer = await actor();
    const requester = (
      await database!.db.select().from(members).where(eq(members.telegramId, 900000002))
    )[0]!;
    const [product] = await database!.db
      .insert(products)
      .values({ slug: 'eggs', name: 'Eggs', unitCode: 'unit', priceCents: 100 })
      .returning();
    const service = createSettingsService(deps);
    await service.update(producer, { notify_new_offer: false });
    const offer = await deps.offers.publish(producer, { productId: product!.id, quantity: 10 });
    expect(
      await database!.db.select().from(notifications).where(eq(notifications.kind, 'N3')),
    ).toHaveLength(0);
    const before = await deps.reservations.create(requester, {
      offerId: offer.offer.id,
      quantity: 1,
    });
    await service.update(producer, { reservation_expiry_hours: 1 / 60 });
    const after = await deps.reservations.create(requester, {
      offerId: offer.offer.id,
      quantity: 1,
    });
    expect(after.reservation.expiresAt!.getTime() - after.reservation.createdAt.getTime()).toBe(
      60_000,
    );
    const unchanged = await deps.reservations.get(requester, before.reservation.id);
    expect(unchanged.reservation.expiresAt).toEqual(before.reservation.expiresAt);
  });
  it('falls back for corrupt persisted values', async () => {
    await database!.db
      .update(settings)
      .set({ value: -1 })
      .where(eq(settings.key, 'offer_nudge_days'));
    expect((await loadSettings(database!.db)).offer_nudge_days).toBe(
      DEFAULT_SETTINGS.offer_nudge_days,
    );
  });
});
