import { Hono } from 'hono';
import type { Me } from '@agrobot/shared';
import { authenticate } from '../middleware/auth.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * `GET /api/me` (ARCH §11). Any authenticated caller, including applicants and suspended
 * members, because this is what the gate screen reads to know which door to show.
 *
 * M1 adds the settings subset and M5 the unread counts.
 */
export function meRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.get('/me', authenticate(deps), (c) => {
    const member = c.get('member')!;
    const body: Me = {
      id: member.id,
      telegramId: String(member.telegramId),
      username: member.username,
      displayName: member.displayName,
      language: member.language,
      role: member.role,
      status: member.status,
    };
    return c.json(body);
  });

  return app;
}
