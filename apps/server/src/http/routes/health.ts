import { Hono } from 'hono';
import type { Health } from '@agrobot/shared';
import { APP_VERSION, GIT_COMMIT } from '../../version.js';
import type { AppContext } from '../context.js';

/**
 * `GET /health` (ARCH §1). Deliberately unauthenticated and free of database access: it is
 * what the container platform polls, and it must answer while Postgres is still waking up.
 */
export function healthRoutes(): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.get('/health', (c) => {
    const body: Health = {
      status: 'ok',
      version: APP_VERSION,
      commit: GIT_COMMIT,
      uptimeSeconds: Math.round(process.uptime()),
    };
    return c.json(body);
  });

  return app;
}
