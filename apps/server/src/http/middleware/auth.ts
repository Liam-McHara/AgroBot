import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { DEFAULT_LANGUAGE, languageFromTelegram } from '@agrobot/shared';
import { members, type Member } from '../../db/schema/index.js';
import { devAuthBypassId } from '../../env.js';
import { unauthenticated } from '../errors.js';
import { verifyInitData, type TelegramUser } from '../init-data.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * ARCH §4: `Authorization: tma <initDataRaw>` on every Mini App request; outside production a
 * configured `Authorization: dev <telegramId>` stands in for it so the app can be opened in a
 * plain browser (ADR-0010).
 *
 * M0 keeps the member row in step with Telegram and creates an applicant for a stranger.
 * M1 moves the creation into `domain/members`, where auto-approval, invites and the N1
 * notification belong; this middleware then calls that service instead of inserting here.
 */

function displayNameFrom(user: TelegramUser): string {
  const parts = [user.firstName, user.lastName].filter((part): part is string => Boolean(part));
  if (parts.length > 0) return parts.join(' ').slice(0, 40);
  if (user.username) return user.username.slice(0, 40);
  return `Telegram ${user.id}`;
}

export async function upsertMember(deps: AppDeps, user: TelegramUser): Promise<Member> {
  const [existing] = await deps.db.select().from(members).where(eq(members.telegramId, user.id));

  if (!existing) {
    const [created] = await deps.db
      .insert(members)
      .values({
        telegramId: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: displayNameFrom(user),
        language: user.language,
        lastSeenAt: new Date(),
      })
      .returning();
    return created!;
  }

  const changed =
    existing.username !== user.username ||
    existing.firstName !== user.firstName ||
    existing.lastName !== user.lastName;

  const [updated] = await deps.db
    .update(members)
    .set({
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      lastSeenAt: new Date(),
      ...(changed ? { updatedAt: new Date() } : {}),
    })
    .where(eq(members.id, existing.id))
    .returning();
  return updated ?? existing;
}

/**
 * Attaches `member` and `language` to the context, or throws `UNAUTHENTICATED`.
 * Status and role are *not* checked here: `GET /api/me` is what the gate screen reads, so an
 * applicant must be able to call it (ARCH §4).
 */
export function authenticate(deps: AppDeps) {
  const bypassId = devAuthBypassId(deps.env);

  return createMiddleware<AppContext>(async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const [scheme, ...rest] = header.split(' ');
    const credentials = rest.join(' ').trim();

    let user: TelegramUser;

    if (scheme === 'tma' && credentials) {
      const result = verifyInitData(credentials, deps.env.BOT_TOKEN);
      if (!result.ok) throw unauthenticated({ reason: result.reason });
      user = result.data.user;
    } else if (scheme === 'dev' && bypassId) {
      // Unreachable in production (`env.ts` refuses the variable there). Any seeded id is
      // accepted so two browser tabs can play both sides of a reservation (ARCH §14).
      const id = credentials === '' ? bypassId : credentials;
      if (!/^\d+$/.test(id)) throw unauthenticated({ reason: 'bad_dev_id' });
      user = {
        id: Number(id),
        username: null,
        firstName: null,
        lastName: null,
        language: languageFromTelegram(c.req.header('accept-language')),
      };
    } else {
      throw unauthenticated({ reason: 'missing_credentials' });
    }

    const member = await upsertMember(deps, user);
    c.set('member', member);
    c.set('language', member.language ?? DEFAULT_LANGUAGE);
    await next();
  });
}
