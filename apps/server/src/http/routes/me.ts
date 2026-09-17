import { Hono } from 'hono';
import type { Me } from '@agrobot/shared';
import { authenticate } from '../middleware/auth.js';
import { loadSettings } from '../../domain/settings/service.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * `GET /api/me` (ARCH §11). Any authenticated caller, including applicants and suspended
 * members, because this is what the gate screen reads to know which door to show.
 *
 * M5 adds the unread counts.
 */
export function meRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.get('/me', authenticate(deps), async (c) => {
    const member = c.get('member')!;
    const groupSettings = await loadSettings(deps.db);
    const body: Me = {
      id: member.id,
      telegramId: String(member.telegramId),
      username: member.username,
      displayName: member.displayName,
      language: member.language,
      role: member.role,
      status: member.status,
      settings: groupSettings,
    };
    return c.json(body);
  });

  return app;
}
