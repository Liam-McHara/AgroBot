import { Hono } from 'hono';
import {
  createReservationSchema,
  reservationActionBodySchema,
  reservationsQuerySchema,
  RESERVATION_ACTIONS,
  type ReservationResponse,
  type ReservationsResponse,
} from '@agrobot/shared';
import type { Member } from '../../db/schema/index.js';
import type { ReservationRecord } from '../../domain/reservations/queries.js';
import { authenticate, requireMember } from '../middleware/auth.js';
import { toReservation, toReservationDetail } from '../serializers.js';
import { parseBody, parseOptionalBody, parseQuery, parseUuidParam } from '../validate.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * ARCH §11 `/reservations` (PRD §8). HTTP in, `domain/reservations` out: the availability
 * check, the price snapshot, the party and status guards and the deduction on delivery all
 * live in the domain, where the bot's *Confirm* / *Reject* quick actions share them. The fifth
 * action, `confirm-and-deliver`, is the Mini App's one-tap handover (ADR-0014); the bot never
 * offers it. Every answer carries the viewer's unread count and, on a detail, the thread's
 * window (PRD US-5.1), which `domain/threads` computes.
 */
export function reservationRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.use('/reservations', authenticate(deps), requireMember);
  app.use('/reservations/*', authenticate(deps), requireMember);

  const detail = async (
    member: Member,
    record: ReservationRecord,
  ): Promise<ReservationResponse> => ({
    reservation: toReservationDetail(record, member, await deps.threads.summary(member, record)),
  });

  app.post('/reservations', async (c) => {
    const member = c.get('member')!;
    const input = await parseBody(c, createReservationSchema);
    const record = await deps.reservations.create(member, input);
    return c.json(await detail(member, record), 201);
  });

  app.get('/reservations', async (c) => {
    const member = c.get('member')!;
    const query = parseQuery(c, reservationsQuerySchema);
    const [records, unread] = await Promise.all([
      deps.reservations.list(member, query),
      deps.threads.unread(member),
    ]);
    const body: ReservationsResponse = {
      reservations: records.map((record) =>
        toReservation(record, member, unread.byReservation.get(record.reservation.id) ?? 0),
      ),
    };
    return c.json(body);
  });

  app.get('/reservations/:id', async (c) => {
    const member = c.get('member')!;
    const record = await deps.reservations.get(member, parseUuidParam(c, 'id'));
    return c.json(await detail(member, record));
  });

  for (const action of RESERVATION_ACTIONS) {
    app.post(`/reservations/:id/${action}`, async (c) => {
      const member = c.get('member')!;
      // Only reject and cancel carry a reason (PRD US-4.2, US-4.3); the others take no body.
      const input =
        action === 'reject' || action === 'cancel'
          ? await parseOptionalBody(c, reservationActionBodySchema)
          : {};
      const record = await deps.reservations.act(member, parseUuidParam(c, 'id'), action, input);
      return c.json(await detail(member, record));
    });
  }

  return app;
}
