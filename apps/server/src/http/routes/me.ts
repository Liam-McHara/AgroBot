import { Hono } from 'hono';
import { updateMeSchema } from '@agrobot/shared';
import { authenticate, requireMember } from '../middleware/auth.js';
import { loadSettings } from '../../domain/settings/service.js';
import { toMe } from '../serializers.js';
import { parseBody } from '../validate.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * `GET /api/me` answers any authenticated caller, applicants and suspended members included,
 * because it is what the gate screen reads to know which door to show (ARCH §4, §11).
 * `PATCH /api/me` (US-1.5) is for members only. M5 adds the unread counts.
 */
export function meRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.get('/me', authenticate(deps), async (c) => {
    const member = c.get('member')!;
    return c.json(toMe(member, await loadSettings(deps.db)));
  });

  app.patch('/me', authenticate(deps), requireMember, async (c) => {
    const body = await parseBody(c, updateMeSchema);
    const updated = await deps.members.updateProfile(c.get('member')!, body);
    return c.json(toMe(updated, await loadSettings(deps.db)));
  });

  return app;
}
