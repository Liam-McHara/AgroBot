import { Hono } from 'hono';
import {
  adminMembersQuerySchema,
  createInviteSchema,
  MEMBER_ACTIONS,
  type AdminMembersResponse,
  type InviteResponse,
  type InvitesResponse,
  type MemberAction,
  type MemberActionResponse,
} from '@agrobot/shared';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { toAdminMember, toInvite } from '../serializers.js';
import { notFound } from '../errors.js';
import { parseBody, parseQuery, parseUuidParam } from '../validate.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * ARCH §11 `/admin/members` and `/admin/invites` (PRD §10 "Members", US-1.2–1.4). The routes
 * only translate HTTP to `domain/members`; every guard, the last-admin one included, is in
 * there so the bot's quick actions get the same answers.
 */
export function adminMemberRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.use('/admin/*', authenticate(deps), requireAdmin);

  app.get('/admin/members', async (c) => {
    const { status } = parseQuery(c, adminMembersQuerySchema);
    const rows = await deps.members.list(c.get('member')!, status);
    const body: AdminMembersResponse = { members: rows.map(toAdminMember) };
    return c.json(body);
  });

  app.post('/admin/members/:id/:action', async (c) => {
    const id = parseUuidParam(c, 'id');
    const action = c.req.param('action');
    if (!(MEMBER_ACTIONS as readonly string[]).includes(action)) throw notFound({ action });
    const member = await deps.members.act(c.get('member')!, id, action as MemberAction);
    const body: MemberActionResponse = { member: toAdminMember(member) };
    return c.json(body);
  });

  app.get('/admin/invites', async (c) => {
    const rows = await deps.members.listInvites(c.get('member')!);
    const body: InvitesResponse = { invites: rows.map(toInvite) };
    return c.json(body);
  });

  app.post('/admin/invites', async (c) => {
    const { identifier } = await parseBody(c, createInviteSchema);
    const invite = await deps.members.createInvite(c.get('member')!, identifier);
    const body: InviteResponse = { invite: toInvite(invite) };
    return c.json(body, 201);
  });

  app.delete('/admin/invites/:id', async (c) => {
    await deps.members.deleteInvite(c.get('member')!, parseUuidParam(c, 'id'));
    return c.body(null, 204);
  });

  return app;
}
