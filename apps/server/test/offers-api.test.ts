import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  boardSchema,
  myOfferResponseSchema,
  myOffersResponseSchema,
  offerDetailResponseSchema,
  type ErrorBody,
} from '@agrobot/shared';
import { members, offers, products, reservations } from '../src/db/schema/index.js';
import { createApp } from '../src/http/app.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

/** The seeded dev members (ARCH §14): Marta speaks ca, Jordi es. */
const MARTA = 900000001;
const JORDI = 900000002;
const STRANGER = 900000777;

suite('offers API (ARCH §11 /board, /offers)', () => {
  let deps: ReturnType<typeof testDeps>;
  let app: ReturnType<typeof createApp>;
  let tomatoId: string;
  let eggsId: string;

  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    telegramId: number,
    body?: unknown,
  ) =>
    app.request(`/api${path}`, {
      method,
      headers: { authorization: `dev ${telegramId}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async <T>(response: Response) => (await response.json()) as T;

  beforeEach(async () => {
    await resetDatabase(database!);
    deps = testDeps(database!, { DEV_AUTH_BYPASS_TELEGRAM_ID: String(MARTA) });
    app = createApp(deps);
    const [tomato, eggs] = await database!.db
      .insert(products)
      .values([
        {
          slug: 'tomaquet',
          name: 'Tomàquet',
          nameEs: 'Tomate',
          unitCode: 'kg',
          priceCents: 235,
          category: 'Horta',
        },
        { slug: 'ous', name: 'Ous', unitCode: 'dozen', priceCents: 350 },
      ])
      .returning();
    tomatoId = tomato!.id;
    eggsId = eggs!.id;
  });

  afterAll(async () => {
    await database?.close();
  });

  it('publishes, lists mine, edits, and shows the offer on the other member’s board', async () => {
    const created = await call('POST', '/offers', MARTA, {
      productId: tomatoId,
      quantity: 12.5,
      availableUntil: '2099-12-31',
      note: 'Collits avui',
    });
    expect(created.status).toBe(201);
    const { offer } = myOfferResponseSchema.parse(await json(created));
    expect(offer).toMatchObject({
      quantity: 12.5,
      held: 0,
      available: 12.5,
      openReservations: 0,
      status: 'active',
      stale: false,
      nudgedAt: null,
      note: 'Collits avui',
      availableUntil: '2099-12-31',
      product: { id: tomatoId, name: 'Tomàquet', unitCode: 'kg', priceCents: 235 },
      producer: { displayName: 'Marta (dev)' },
    });
    // ARCH §8 step 2, §7: N3 was committed, so the hub was woken, and every board refetches.
    expect(deps.hub.wakes).toBe(1);
    expect(deps.hub.published.at(-1)).toMatchObject({ event: { type: 'board.changed' } });

    const mine = myOffersResponseSchema.parse(await json(await call('GET', '/offers/mine', MARTA)));
    expect(mine.offers.map((o) => o.id)).toEqual([offer.id]);
    // The board of the producer does not show their own offer (US-3.3).
    expect(boardSchema.parse(await json(await call('GET', '/board', MARTA))).total).toBe(0);

    const board = boardSchema.parse(
      await json(await call('GET', '/board?group=producer&q=tom&category=Horta', JORDI)),
    );
    expect(board).toMatchObject({ group: 'producer', total: 1, categories: ['Horta'] });
    expect(board.groups[0]).toMatchObject({ name: 'Marta (dev)', nameEs: null });
    const row = board.groups[0]!.offers[0]!;
    expect(row).toMatchObject({ id: offer.id, available: 12.5, note: 'Collits avui' });
    expect(row).not.toHaveProperty('quantity');
    expect(row).not.toHaveProperty('held');

    const edited = await call('PATCH', `/offers/${offer.id}`, MARTA, { quantity: 8, note: null });
    expect(edited.status).toBe(200);
    expect(myOfferResponseSchema.parse(await json(edited)).offer).toMatchObject({
      quantity: 8,
      note: null,
      availableUntil: '2099-12-31',
    });
  });

  it('answers the ARCH §11 error codes: 409 with the existing id, 422 with the held floor, 400, 403, 404', async () => {
    const first = myOfferResponseSchema.parse(
      await json(await call('POST', '/offers', MARTA, { productId: tomatoId, quantity: 10 })),
    ).offer;

    const duplicate = await call('POST', '/offers', MARTA, { productId: tomatoId, quantity: 3 });
    expect(duplicate.status).toBe(409);
    expect(await json<ErrorBody>(duplicate)).toEqual({
      error: {
        code: 'OFFER_ALREADY_ACTIVE',
        message: "Ja tens una oferta activa d'aquest producte.",
        details: { offerId: first.id },
      },
    });

    const [jordi] = await database!.db.select().from(members).where(eq(members.telegramId, JORDI));
    const [marta] = await database!.db.select().from(members).where(eq(members.telegramId, MARTA));
    await database!.db.insert(reservations).values({
      offerId: first.id,
      requesterId: jordi!.id,
      producerId: marta!.id,
      quantity: '2.5',
      unitPriceCents: 235,
      status: 'confirmed',
    });
    const below = await call('PATCH', `/offers/${first.id}`, MARTA, { quantity: 2 });
    expect(below.status).toBe(422);
    expect(await json<ErrorBody>(below)).toEqual({
      error: {
        code: 'OFFER_QUANTITY_BELOW_HELD',
        message: 'No pots baixar per sota de 2,5: és el que ja tens reservat.',
        details: { held: 2.5 },
      },
    });
    // The Spanish member reads the same rule in Spanish (PRD principle 6).
    const forbidden = await call('PATCH', `/offers/${first.id}`, JORDI, { quantity: 1 });
    expect(forbidden.status).toBe(403);
    expect((await json<ErrorBody>(forbidden)).error.message).toBe(
      'No tienes permiso para hacer esto.',
    );

    expect(
      (await call('POST', '/offers', MARTA, { productId: eggsId, quantity: 1.5 })).status,
    ).toBe(400);
    expect((await call('POST', '/offers', MARTA, { productId: eggsId, quantity: 0 })).status).toBe(
      400,
    );
    expect(
      (
        await call('POST', '/offers', MARTA, {
          productId: eggsId,
          quantity: 1,
          availableUntil: '2000-01-01',
        })
      ).status,
    ).toBe(400);
    expect((await call('PATCH', `/offers/${first.id}`, MARTA, {})).status).toBe(400);
    expect((await call('GET', '/board?group=price', JORDI)).status).toBe(400);
    expect((await call('GET', '/offers/not-a-uuid', JORDI)).status).toBe(400);
    expect((await call('GET', '/offers/00000000-0000-4000-8000-000000000000', JORDI)).status).toBe(
      404,
    );
    // Applicants stay at the gate for every offer route.
    expect((await call('GET', '/board', STRANGER)).status).toBe(403);
    expect((await call('GET', '/offers/mine', STRANGER)).status).toBe(403);
    expect(
      (await call('POST', '/offers', STRANGER, { productId: eggsId, quantity: 1 })).status,
    ).toBe(403);
  });

  it('withdraws and confirms availability; the detail hides totals from other members', async () => {
    const { offer } = myOfferResponseSchema.parse(
      await json(await call('POST', '/offers', MARTA, { productId: eggsId, quantity: 4 })),
    );
    await database!.db
      .update(offers)
      .set({ stale: true, nudgedAt: new Date() })
      .where(eq(offers.id, offer.id));

    const asOther = offerDetailResponseSchema.parse(
      await json(await call('GET', `/offers/${offer.id}`, JORDI)),
    );
    expect(asOther.offer).toMatchObject({
      id: offer.id,
      available: 4,
      stale: true,
      quantity: null,
      held: null,
      openReservations: null,
      nudgedAt: null,
    });
    const asMine = offerDetailResponseSchema.parse(
      await json(await call('GET', `/offers/${offer.id}`, MARTA)),
    );
    expect(asMine.offer).toMatchObject({ quantity: 4, held: 0, openReservations: 0 });
    expect(asMine.offer.nudgedAt).not.toBeNull();

    const still = await call('POST', `/offers/${offer.id}/still-available`, MARTA);
    expect(still.status).toBe(200);
    expect(myOfferResponseSchema.parse(await json(still)).offer).toMatchObject({
      stale: false,
      nudgedAt: null,
    });

    const withdrawn = await call('POST', `/offers/${offer.id}/withdraw`, MARTA);
    expect(withdrawn.status).toBe(200);
    expect(myOfferResponseSchema.parse(await json(withdrawn)).offer.status).toBe('withdrawn');
    expect(boardSchema.parse(await json(await call('GET', '/board', JORDI))).total).toBe(0);
    expect(
      myOffersResponseSchema.parse(await json(await call('GET', '/offers/mine', MARTA))).offers,
    ).toEqual([]);
    const again = await call('POST', `/offers/${offer.id}/withdraw`, MARTA);
    expect(again.status).toBe(422);
    expect((await json<ErrorBody>(again)).error.code).toBe('INVALID_TRANSITION');
    // The deep link still resolves after withdrawal (ARCH §4 `o_<id>`).
    expect(
      offerDetailResponseSchema.parse(await json(await call('GET', `/offers/${offer.id}`, JORDI)))
        .offer.status,
    ).toBe('withdrawn');
  });
});
