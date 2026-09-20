import { Hono } from 'hono';
import { NO_UNREAD, updateMeSchema } from '@agrobot/shared';
import type { Member } from '../../db/schema/index.js';
import { authenticate, requireMember } from '../middleware/auth.js';
import { loadSettings } from '../../domain/settings/service.js';
import { toMe } from '../serializers.js';
import { parseBody } from '../validate.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * `GET /api/me` answers any authenticated caller, applicants and suspended members included,
 * because it is what the gate screen reads to know which door to show (ARCH §4, §11).
 * `PATCH /api/me` (US-1.5) is for members only. Both carry the unread counts behind the
 * Reservations badge (PRD US-4.6); someone who cannot open a thread has none to count.
 */
export function meRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();

  const me = async (member: Member) => {
    const [settings, unread] = await Promise.all([
      loadSettings(deps.db),
      member.status === 'approved' ? deps.threads.unread(member) : NO_UNREAD,
    ]);
    return toMe(member, settings, unread);
  };

  app.get('/me', authenticate(deps), async (c) => {
    return c.json(await me(c.get('member')!));
  });

  app.patch('/me', authenticate(deps), requireMember, async (c) => {
    const body = await parseBody(c, updateMeSchema);
    return c.json(await me(await deps.members.updateProfile(c.get('member')!, body)));
  });

  return app;
}
