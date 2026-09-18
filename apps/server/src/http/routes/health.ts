import { Hono } from 'hono';
import type { Health } from '@agrobot/shared';
import { APP_VERSION, gitCommit } from '../../version.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * `GET /health` (ARCH §1). Deliberately unauthenticated and free of database access: it is
 * what the e2e suite and a curious admin poll, and it must answer while Neon is still waking.
 */
export function healthRoutes(deps: Pick<AppDeps, 'env'>): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.get('/health', (c) => {
    const body: Health = { status: 'ok', version: APP_VERSION, commit: gitCommit(deps.env) };
    return c.json(body);
  });

  return app;
}
