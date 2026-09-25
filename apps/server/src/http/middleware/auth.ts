import { createMiddleware } from 'hono/factory';
import { DEFAULT_LANGUAGE, languageFromTelegram } from '@agrobot/shared';
import { devAuthBypassId } from '../../env.js';
import { assertAdmin, assertMember } from '../../domain/members/service.js';
import type { TelegramIdentity } from '../../domain/members/rules.js';
import { unauthenticated } from '../errors.js';
import { verifyInitData } from '../init-data.js';
import { enforceRateLimit } from './limits.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * ARCH §4: `Authorization: tma <initDataRaw>` on every Mini App request; outside production a
 * configured `Authorization: dev <telegramId>` stands in for it so the app can be opened in a
 * plain browser (ADR-0010).
 *
 * Who the caller *is* comes from here; what they may do comes from `domain/members`, so the
 * bot's quick actions and these routes cannot drift apart (ARCH §17).
 */
export function authenticate(deps: AppDeps) {
  const bypassId = devAuthBypassId(deps.env);

  return createMiddleware<AppContext>(async (c, next) => {
    // Route files may each guard their own paths; the second guard on one request is a no-op.
    if (c.get('member')) {
      await next();
      return;
    }
    const header = c.req.header('authorization') ?? '';
    const [scheme, ...rest] = header.split(' ');
    const credentials = rest.join(' ').trim();

    let identity: TelegramIdentity;

    if (scheme === 'tma' && credentials) {
      const result = verifyInitData(credentials, deps.env.BOT_TOKEN);
      if (!result.ok) throw unauthenticated({ reason: result.reason });
      identity = result.data.user;
    } else if (scheme === 'dev' && bypassId) {
      // Unreachable in production (`env.ts` refuses the variable there). Any id is accepted
      // so two browser tabs can play both sides of a reservation (ARCH §14).
      const id = credentials === '' ? bypassId : credentials;
      if (!/^\d+$/.test(id)) throw unauthenticated({ reason: 'bad_dev_id' });
      identity = {
        id: Number(id),
        username: null,
        firstName: null,
        lastName: null,
        language: languageFromTelegram(c.req.header('accept-language')),
      };
    } else {
      throw unauthenticated({ reason: 'missing_credentials' });
    }

    const { member } = await deps.members.identify(identity);
    c.set('member', member);
    c.set('language', member.language ?? DEFAULT_LANGUAGE);
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.req.method)) {
      await enforceRateLimit(c, deps.hub, `member:${member.id}`, 60);
    }
    await next();
  });
}

/** ARCH §4 route guard: status `approved`. Applicants and suspended members get the gate. */
export const requireMember = createMiddleware<AppContext>(async (c, next) => {
  const member = c.get('member');
  if (!member) throw unauthenticated({ reason: 'missing_credentials' });
  assertMember(member);
  await next();
});

/** ARCH §4 route guard: role `admin` (and approved). */
export const requireAdmin = createMiddleware<AppContext>(async (c, next) => {
  const member = c.get('member');
  if (!member) throw unauthenticated({ reason: 'missing_credentials' });
  assertAdmin(member);
  await next();
});
