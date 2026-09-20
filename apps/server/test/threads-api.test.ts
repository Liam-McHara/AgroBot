import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  meSchema,
  messageResponseSchema,
  messagesResponseSchema,
  myOfferResponseSchema,
  readThreadResponseSchema,
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

suite('threads API (ARCH §11 /reservations/:id/messages, /read; PRD US-5.1)', () => {
  let deps: ReturnType<typeof testDeps>;
  let app: ReturnType<typeof createApp>;
  let reservationId: string;

  const call = (method: 'GET' | 'POST', path: string, telegramId: number, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { authorization: `dev ${telegramId}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async <T>(response: Response) => (await response.json()) as T;
  const post = async (telegramId: number, body: string) => {
    const response = await call('POST', `/reservations/${reservationId}/messages`, telegramId, {
      body,
    });
    expect(response.status).toBe(201);
    return messageResponseSchema.parse(await json(response)).message;
  };

  beforeEach(async () => {
    await resetDatabase(database!);
    deps = testDeps(database!, { DEV_AUTH_BYPASS_TELEGRAM_ID: String(MARTA) });
    app = createApp(deps);
    const [eggs] = await database!.db
      .insert(products)
      .values({ slug: 'ous', name: 'Ous', nameEs: 'Huevos', unitCode: 'dozen', priceCents: 310 })
      .returning();
    const offer = myOfferResponseSchema.parse(
      await json(await call('POST', '/offers', MARTA, { productId: eggs!.id, quantity: 6 })),
    ).offer;
    const created = await call('POST', '/reservations', JORDI, { offerId: offer.id, quantity: 2 });
    reservationId = reservationResponseSchema.parse(await json(created)).reservation.id;
    deps.hub.wakes = 0;
    deps.hub.published = [];
  });

  afterAll(async () => {
    await database?.close();
  });

  it('lists the thread with system lines, posts a message, counts it unread for the other side, and reads it', async () => {
    // The requester's own view: the first system line is theirs.
    const before = messagesResponseSchema.parse(
      await json(await call('GET', `/reservations/${reservationId}/messages`, JORDI)),
    );
    expect(before.hasMore).toBe(false);
    expect(before.messages).toMatchObject([
      {
        kind: 'system',
        body: 'created',
        sender: null,
        mine: false,
        meta: { event: 'created', actorName: 'Jordi (dev)', reason: null, cause: null },
      },
    ]);

    const posted = await post(JORDI, '  Demà a les 10?  ');
    expect(posted).toMatchObject({
      reservationId,
      kind: 'text',
      body: 'Demà a les 10?',
      sender: { displayName: 'Jordi (dev)' },
      mine: true,
      meta: null,
    });
    expect(deps.hub.published).toEqual([
      { memberIds: expect.any(Array), event: { type: 'message.new', reservationId } },
    ]);
    expect(deps.hub.wakes).toBe(1);

    // The producer sees it as theirs-not-mine, unread on /me, on the row and on the detail.
    const theirs = messagesResponseSchema.parse(
      await json(await call('GET', `/reservations/${reservationId}/messages`, MARTA)),
    );
    expect(theirs.messages.map((m) => [m.body, m.mine])).toEqual([
      ['created', false],
      ['Demà a les 10?', false],
    ]);
    const me = meSchema.parse(await json(await call('GET', '/me', MARTA)));
    expect(me.unread).toEqual({ total: 1, incoming: 1, outgoing: 0 });
    const rows = reservationsResponseSchema.parse(
      await json(await call('GET', '/reservations?side=incoming', MARTA)),
    );
    expect(rows.reservations[0]).toMatchObject({ id: reservationId, unread: 1 });
    const detail = reservationResponseSchema.parse(
      await json(await call('GET', `/reservations/${reservationId}`, MARTA)),
    );
    expect(detail.reservation).toMatchObject({
      unread: 1,
      thread: { writable: true, writableUntil: null },
    });
    // The sender has nothing unread.
    expect(meSchema.parse(await json(await call('GET', '/me', JORDI))).unread.total).toBe(0);

    const read = await call('POST', `/reservations/${reservationId}/read`, MARTA);
    expect(read.status).toBe(200);
    expect(readThreadResponseSchema.parse(await json(read)).unread).toEqual({
      total: 0,
      incoming: 0,
      outgoing: 0,
    });
    expect(meSchema.parse(await json(await call('GET', '/me', MARTA))).unread.total).toBe(0);

    // `after` pages forward from a message already held.
    const page = messagesResponseSchema.parse(
      await json(
        await call(
          'GET',
          `/reservations/${reservationId}/messages?after=${before.messages[0]!.id}&limit=1`,
          MARTA,
        ),
      ),
    );
    expect(page.messages.map((m) => m.body)).toEqual(['Demà a les 10?']);
    expect(page.hasMore).toBe(false);
  });

  it('answers the errors of ARCH §11: not a party, unusable body, bad cursor, read-only thread', async () => {
    // An approved member who is neither party (an admin is no different, PRD US-5.1).
    await database!.db.insert(members).values({
      telegramId: STRANGER,
      displayName: 'Pere',
      role: 'admin',
      status: 'approved',
    });
    const stranger = await call('GET', `/reservations/${reservationId}/messages`, STRANGER);
    expect(stranger.status).toBe(403);
    expect((await json<ErrorBody>(stranger)).error.code).toBe('FORBIDDEN');
    expect(
      (await call('POST', `/reservations/${reservationId}/messages`, STRANGER, { body: 'x' }))
        .status,
    ).toBe(403);
    expect((await call('POST', `/reservations/${reservationId}/read`, STRANGER)).status).toBe(403);

    const blank = await call('POST', `/reservations/${reservationId}/messages`, JORDI, {
      body: '   ',
    });
    expect(blank.status).toBe(400);
    expect((await json<ErrorBody>(blank)).error.code).toBe('VALIDATION');
    expect((await call('POST', `/reservations/${reservationId}/messages`, JORDI, {})).status).toBe(
      400,
    );
    expect(
      (
        await call(
          'GET',
          `/reservations/${reservationId}/messages?after=00000000-0000-4000-8000-000000000000`,
          JORDI,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call('GET', `/reservations/${reservationId}/messages?limit=0`, JORDI)).status,
    ).toBe(400);

    // Closed 8 days ago: read-only, with the localized message of the reader.
    await call('POST', `/reservations/${reservationId}/reject`, MARTA, {});
    await database!.db
      .update(reservations)
      .set({ closedAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(reservations.id, reservationId));
    const readonly = await call('POST', `/reservations/${reservationId}/messages`, JORDI, {
      body: 'Llàstima',
    });
    expect(readonly.status).toBe(403);
    const body = await json<ErrorBody>(readonly);
    expect(body.error.code).toBe('THREAD_READONLY');
    expect(body.error.message).toBe('Esta conversación ya está cerrada.');
    const detail = reservationResponseSchema.parse(
      await json(await call('GET', `/reservations/${reservationId}`, JORDI)),
    );
    expect(detail.reservation.thread.writable).toBe(false);
    expect(detail.reservation.thread.writableUntil).not.toBeNull();
  });

  it('gives an applicant no unread counts and keeps the thread routes behind the member gate', async () => {
    await database!.db.insert(members).values({
      telegramId: STRANGER,
      displayName: 'Applicant',
      status: 'pending',
    });
    const me = meSchema.parse(await json(await call('GET', '/me', STRANGER)));
    expect(me.status).toBe('pending');
    expect(me.unread).toEqual({ total: 0, incoming: 0, outgoing: 0 });
    const gated = await call('GET', `/reservations/${reservationId}/messages`, STRANGER);
    expect(gated.status).toBe(403);
    expect((await json<ErrorBody>(gated)).error.code).toBe('NOT_APPROVED');
  });
});
