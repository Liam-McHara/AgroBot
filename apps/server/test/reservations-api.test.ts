import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  myOfferResponseSchema,
  myOffersResponseSchema,
  reservationResponseSchema,
  reservationsResponseSchema,
  type ErrorBody,
} from '@agrobot/shared';
import { members, products, reservations } from '../src/db/schema/index.js';
import { createApp } from '../src/http/app.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

/** The seeded dev members (ARCH §14): Marta speaks ca, Jordi es. */
const MARTA = 900000001;
const JORDI = 900000002;
const STRANGER = 900000777;

suite('reservations API (ARCH §11 /reservations)', () => {
  let deps: ReturnType<typeof testDeps>;
  let app: ReturnType<typeof createApp>;
  let eggsId: string;

  const call = (method: 'GET' | 'POST', path: string, telegramId: number, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { authorization: `dev ${telegramId}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async <T>(response: Response) => (await response.json()) as T;

  async function publish(quantity: number, telegramId = MARTA) {
    const response = await call('POST', '/offers', telegramId, { productId: eggsId, quantity });
    return myOfferResponseSchema.parse(await json(response)).offer;
  }

  beforeEach(async () => {
    await resetDatabase(database!);
    deps = testDeps(database!, { DEV_AUTH_BYPASS_TELEGRAM_ID: String(MARTA) });
    app = createApp(deps);
    const [eggs] = await database!.db
      .insert(products)
      .values({ slug: 'ous', name: 'Ous', nameEs: 'Huevos', unitCode: 'dozen', priceCents: 310 })
      .returning();
    eggsId = eggs!.id;
  });

  afterAll(async () => {
    await database?.close();
  });

  it('reserves, lists by side and state, shows the detail to both parties and walks confirm → deliver', async () => {
    const offer = await publish(6);
    deps.hub.wakes = 0;
    deps.hub.published = [];

    const created = await call('POST', '/reservations', JORDI, { offerId: offer.id, quantity: 2 });
    expect(created.status).toBe(201);
    const { reservation } = reservationResponseSchema.parse(await json(created));
    expect(reservation).toMatchObject({
      status: 'pending',
      side: 'outgoing',
      quantity: 2,
      unitPriceCents: 310,
      totalCents: 620,
      currency: 'EUR',
      product: { id: eggsId, name: 'Ous', unitCode: 'dozen' },
      requester: { displayName: 'Jordi (dev)' },
      producer: { displayName: 'Marta (dev)' },
      counterpart: { displayName: 'Marta (dev)' },
      actions: ['cancel'],
      offer: { id: offer.id, status: 'active', available: 4 },
      confirmedAt: null,
      deliveredAt: null,
      closedAt: null,
      reason: null,
    });
    expect(reservation.expiresAt).not.toBeNull();
    // ARCH §7–§9: N6 and a deadline were committed, so the hub was woken; the parties and
    // every board were told.
    expect(deps.hub.wakes).toBe(1);
    expect(deps.hub.published.map((p) => p.event.type)).toEqual([
      'reservation.changed',
      'board.changed',
    ]);

    // The producer's view: incoming, with the producer's actions.
    const incoming = reservationsResponseSchema.parse(
      await json(await call('GET', '/reservations?side=incoming', MARTA)),
    );
    expect(incoming.reservations).toHaveLength(1);
    expect(incoming.reservations[0]).toMatchObject({
      id: reservation.id,
      side: 'incoming',
      counterpart: { displayName: 'Jordi (dev)' },
      actions: ['confirm', 'reject', 'confirm-and-deliver'],
    });
    expect(
      reservationsResponseSchema.parse(
        await json(await call('GET', '/reservations?side=outgoing&state=active', MARTA)),
      ).reservations,
    ).toEqual([]);
    expect(
      reservationsResponseSchema
        .parse(await json(await call('GET', '/reservations?side=outgoing', JORDI)))
        .reservations.map((r) => r.id),
    ).toEqual([reservation.id]);

    // My offers shows what is held (US-3.2), and the edit floor follows it.
    const mine = myOffersResponseSchema.parse(await json(await call('GET', '/offers/mine', MARTA)));
    expect(mine.offers[0]).toMatchObject({
      quantity: 6,
      held: 2,
      available: 4,
      openReservations: 1,
    });
    expect(
      (await call('PATCH' as never, `/offers/${offer.id}`, MARTA, { quantity: 1 })).status,
    ).toBe(422);

    const confirmed = await call('POST', `/reservations/${reservation.id}/confirm`, MARTA);
    expect(confirmed.status).toBe(200);
    expect(reservationResponseSchema.parse(await json(confirmed)).reservation).toMatchObject({
      status: 'confirmed',
      expiresAt: null,
      actions: ['deliver', 'cancel'],
    });

    const detail = reservationResponseSchema.parse(
      await json(await call('GET', `/reservations/${reservation.id}`, JORDI)),
    );
    expect(detail.reservation).toMatchObject({
      status: 'confirmed',
      actions: ['deliver', 'cancel'],
    });
    expect(detail.reservation.confirmedAt).not.toBeNull();

    const delivered = await call('POST', `/reservations/${reservation.id}/deliver`, JORDI);
    expect(reservationResponseSchema.parse(await json(delivered)).reservation).toMatchObject({
      status: 'delivered',
      actions: [],
      offer: { available: 4 },
    });
    // ARCH §5: delivered deducts; the offer is 4 in total now, nothing held.
    const after = myOffersResponseSchema.parse(
      await json(await call('GET', '/offers/mine', MARTA)),
    );
    expect(after.offers[0]).toMatchObject({
      quantity: 4,
      held: 0,
      available: 4,
      openReservations: 0,
    });
    const closed = reservationsResponseSchema.parse(
      await json(await call('GET', '/reservations?side=incoming&state=closed', MARTA)),
    );
    expect(closed.reservations.map((r) => r.status)).toEqual(['delivered']);
  });

  it('confirm-and-deliver is one request for the producer; reject and cancel carry an optional reason', async () => {
    const offer = await publish(6);
    const a = reservationResponseSchema.parse(
      await json(await call('POST', '/reservations', JORDI, { offerId: offer.id, quantity: 1 })),
    ).reservation;
    const b = reservationResponseSchema.parse(
      await json(await call('POST', '/reservations', JORDI, { offerId: offer.id, quantity: 1 })),
    ).reservation;
    const c = reservationResponseSchema.parse(
      await json(await call('POST', '/reservations', JORDI, { offerId: offer.id, quantity: 1 })),
    ).reservation;

    const oneTap = await call('POST', `/reservations/${a.id}/confirm-and-deliver`, MARTA);
    expect(oneTap.status).toBe(200);
    const done = reservationResponseSchema.parse(await json(oneTap)).reservation;
    expect(done.status).toBe('delivered');
    expect(done.confirmedAt).not.toBeNull();
    expect(done.deliveredAt).not.toBeNull();

    const rejected = await call('POST', `/reservations/${b.id}/reject`, MARTA, {
      reason: '  Ja no en tinc  ',
    });
    expect(reservationResponseSchema.parse(await json(rejected)).reservation).toMatchObject({
      status: 'rejected',
      reason: 'Ja no en tinc',
    });
    // No body at all is fine for cancel.
    const cancelled = await app.request(`/api/reservations/${c.id}/cancel`, {
      method: 'POST',
      headers: { authorization: `dev ${JORDI}` },
    });
    expect(cancelled.status).toBe(200);
    expect(reservationResponseSchema.parse(await json(cancelled)).reservation).toMatchObject({
      status: 'cancelled',
      reason: null,
    });
    expect(
      (await call('POST', `/reservations/${c.id}/cancel`, JORDI, { reason: 'x'.repeat(201) }))
        .status,
    ).toBe(400);
  });

  it('answers the ARCH §11 error codes: 409 with what is left, 403 for wrong parties, 422 for stale actions, 404, 400', async () => {
    const offer = await publish(3);
    const conflict = await call('POST', '/reservations', JORDI, { offerId: offer.id, quantity: 5 });
    expect(conflict.status).toBe(409);
    expect(await json<ErrorBody>(conflict)).toEqual({
      error: {
        code: 'INSUFFICIENT_AVAILABILITY',
        message: 'Solo quedan 3. ¿Quieres reservar esa cantidad?',
        details: { available: 3 },
      },
    });
    const own = await call('POST', '/reservations', MARTA, { offerId: offer.id, quantity: 1 });
    expect(own.status).toBe(403);
    expect((await json<ErrorBody>(own)).error.code).toBe('FORBIDDEN');

    const { reservation } = reservationResponseSchema.parse(
      await json(await call('POST', '/reservations', JORDI, { offerId: offer.id, quantity: 1 })),
    );
    // A requester pressing the producer's buttons.
    const notMine = await call('POST', `/reservations/${reservation.id}/confirm`, JORDI);
    expect(notMine.status).toBe(403);
    // A third member is no party at all.
    const [pere] = await database!.db
      .insert(members)
      .values({ telegramId: 900000003, displayName: 'Pere', status: 'approved' })
      .returning();
    expect((await call('GET', `/reservations/${reservation.id}`, 900000003)).status).toBe(403);
    expect(pere).toBeTruthy();
    // Stale: cancel, then the producer's confirm.
    await call('POST', `/reservations/${reservation.id}/cancel`, JORDI);
    const stale = await call('POST', `/reservations/${reservation.id}/confirm`, MARTA);
    expect(stale.status).toBe(422);
    expect(await json<ErrorBody>(stale)).toEqual({
      error: {
        code: 'INVALID_TRANSITION',
        message: 'Aquesta acció ja no és possible.',
        details: { action: 'confirm', status: 'cancelled' },
      },
    });

    expect(
      (await call('GET', '/reservations/00000000-0000-4000-8000-000000000000', JORDI)).status,
    ).toBe(404);
    expect((await call('GET', '/reservations/not-a-uuid', JORDI)).status).toBe(400);
    expect((await call('GET', '/reservations', JORDI)).status).toBe(400);
    expect((await call('GET', '/reservations?side=mine', JORDI)).status).toBe(400);
    expect(
      (await call('POST', '/reservations', JORDI, { offerId: offer.id, quantity: 0.5 })).status,
    ).toBe(400);
    expect((await call('POST', `/reservations/${reservation.id}/nope`, MARTA)).status).toBe(404);
    // Applicants stay at the gate.
    expect((await call('GET', '/reservations?side=incoming', STRANGER)).status).toBe(403);
    expect(
      (await call('POST', '/reservations', STRANGER, { offerId: offer.id, quantity: 1 })).status,
    ).toBe(403);
  });

  it('N parallel requests for the last unit: exactly one 201, the rest 409 with available 0', async () => {
    const offer = await publish(1);
    const racers = [900000011, 900000012, 900000013, 900000014, 900000015, 900000016];
    await database!.db.insert(members).values(
      racers.map((telegramId) => ({
        telegramId,
        displayName: `Racer ${telegramId}`,
        status: 'approved' as const,
      })),
    );
    const responses = await Promise.all(
      racers.map((id) => call('POST', '/reservations', id, { offerId: offer.id, quantity: 1 })),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    for (const response of responses.filter((r) => r.status === 409)) {
      expect((await json<ErrorBody>(response)).error).toMatchObject({
        code: 'INSUFFICIENT_AVAILABILITY',
        details: { available: 0 },
      });
    }
    const held = await database!.db
      .select()
      .from(reservations)
      .where(eq(reservations.offerId, offer.id));
    expect(held).toHaveLength(1);
  });
});
