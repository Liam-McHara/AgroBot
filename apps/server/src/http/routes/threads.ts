import { Hono } from 'hono';
import {
  messagesQuerySchema,
  postMessageSchema,
  type MessageResponse,
  type MessagesResponse,
  type ReadThreadResponse,
} from '@agrobot/shared';
import { authenticate, requireMember } from '../middleware/auth.js';
import { toMessage, toUnreadCounts } from '../serializers.js';
import { parseBody, parseQuery, parseUuidParam } from '../validate.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * ARCH §11, the thread of a reservation (PRD US-5.1): the messages in pages, posting one, and
 * marking the thread read. The party check, the read-only window and the N9 throttle live in
 * `domain/threads`; the routes only translate HTTP.
 */
export function threadRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.use('/reservations/:id/messages', authenticate(deps), requireMember);
  app.use('/reservations/:id/read', authenticate(deps), requireMember);

  app.get('/reservations/:id/messages', async (c) => {
    const member = c.get('member')!;
    const page = await deps.threads.list(
      member,
      parseUuidParam(c, 'id'),
      parseQuery(c, messagesQuerySchema),
    );
    const body: MessagesResponse = {
      messages: page.messages.map((record) => toMessage(record, member)),
      hasMore: page.hasMore,
    };
    return c.json(body);
  });

  app.post('/reservations/:id/messages', async (c) => {
    const member = c.get('member')!;
    const input = await parseBody(c, postMessageSchema);
    const record = await deps.threads.post(member, parseUuidParam(c, 'id'), input);
    const body: MessageResponse = { message: toMessage(record, member) };
    return c.json(body, 201);
  });

  app.post('/reservations/:id/read', async (c) => {
    const member = c.get('member')!;
    const unread = await deps.threads.read(member, parseUuidParam(c, 'id'));
    const body: ReadThreadResponse = { unread: toUnreadCounts(unread) };
    return c.json(body);
  });

  return app;
}
