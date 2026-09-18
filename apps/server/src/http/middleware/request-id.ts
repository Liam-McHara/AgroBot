import { createMiddleware } from 'hono/factory';
import type { AppContext } from '../context.js';

/**
 * One id per request, echoed in `X-Request-Id` and attached to every log line and to the
 * `INTERNAL` error message, so a member can quote it when something breaks (ARCH §11).
 */
export const requestId = createMiddleware<AppContext>(async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && incoming.length <= 200 ? incoming : crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
});
