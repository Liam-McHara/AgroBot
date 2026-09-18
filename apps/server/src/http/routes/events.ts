import { Hono } from 'hono';
import type { EventsTicketResponse } from '@agrobot/shared';
import { allowedSocketOrigins } from '../../env.js';
import { authenticate } from '../middleware/auth.js';
import { forbidden, unauthenticated, validationFailed } from '../errors.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * ARCH §7: the realtime socket is opened in two steps. `POST /api/events/ticket` runs the
 * usual `tma` authentication and returns a random, single-use ticket that lives 30 seconds in
 * the hub; `GET /api/events?ticket=` is the WebSocket upgrade, which a browser cannot add
 * headers to, so the ticket stands in for `initData` — which must never appear in a URL.
 *
 * Any authenticated person may hold a socket, applicants included: the only frame they can
 * receive is `me.changed`, which is how the gate learns of an approval without polling `/me`
 * on a timer (ADR-0016). Everything else still needs an approved member.
 *
 * The Worker checks the `Origin` against `PUBLIC_URL` (ARCH §17) and forwards the upgrade to
 * the hub, which redeems the ticket and accepts the socket with the Hibernation API.
 */
export function eventsRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();
  const origins = new Set(allowedSocketOrigins(deps.env));

  app.post('/events/ticket', authenticate(deps), async (c) => {
    const ticket = await deps.hub.issueTicket(c.get('member')!.id);
    const body: EventsTicketResponse = { ticket };
    return c.json(body);
  });

  app.get('/events', async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      throw validationFailed({ upgrade: 'expected a WebSocket upgrade' });
    }
    const origin = c.req.header('origin');
    if (!origin || !origins.has(origin)) throw forbidden({ reason: 'origin' });
    if (!c.req.query('ticket')) throw unauthenticated({ reason: 'missing_ticket' });
    return deps.hub.upgrade(c.req.raw);
  });

  return app;
}
