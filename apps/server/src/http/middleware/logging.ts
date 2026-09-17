import { createMiddleware } from 'hono/factory';
import type { Logger } from '../../logger.js';
import type { AppContext } from '../context.js';

/** One structured line per request (PRD §12 Observability). */
export function requestLogging(logger: Logger) {
  return createMiddleware<AppContext>(async (c, next) => {
    const requestLogger = logger.child({ requestId: c.get('requestId') });
    c.set('logger', requestLogger);

    const startedAt = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - startedAt);

    const payload = {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
      memberId: c.get('member')?.id,
    };
    if (c.res.status >= 500) requestLogger.error(payload, 'request failed');
    else if (c.res.status >= 400) requestLogger.warn(payload, 'request rejected');
    else requestLogger.info(payload, 'request');
  });
}
