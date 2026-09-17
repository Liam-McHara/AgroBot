import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AdminMembersResponse,
  ErrorBody,
  InviteResponse,
  InvitesResponse,
  Me,
  MemberActionResponse,
} from '@agrobot/shared';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testApp } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

/**
 * M1 routes (ARCH §11): `PATCH /me`, `/admin/members`, `/admin/invites`. The dev bypass
 * signs requests, since who the caller is was proven in `api.test.ts`; `ADMIN_TELEGRAM_IDS`
 * bootstraps the admin (PRD US-1.1).
 */
const ADMIN = '800000001';
const STRANGER = '800000002';
const OTHER = '800000003';

function app() {
  return testApp(database!, { DEV_AUTH_BYPASS_TELEGRAM_ID: ADMIN, ADMIN_TELEGRAM_IDS: ADMIN });
}

async function call<T>(
  as: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const response = await app().request(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `dev ${as}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

async function applicant(telegramId: string): Promise<Me> {
  return (await call<Me>(telegramId, '/me')).body;
}

suite('membership API', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
  });

  afterAll(async () => {
    await database?.close();
  });

  describe('GET /me', () => {
    it('bootstraps a configured admin and returns the group settings', async () => {
      const { status, body } = await call<Me>(ADMIN, '/me');
      expect(status).toBe(200);
      expect(body).toMatchObject({ role: 'admin', status: 'approved' });
      expect(body.settings.reservation_expiry_hours).toBe(48);
    });
  });

  describe('PATCH /me (US-1.5)', () => {
    it('lets a member change language and display name', async () => {
      const { status, body } = await call<Me>(ADMIN, '/me', {
        method: 'PATCH',
        body: { language: 'es', displayName: '  Guillem  ' },
      });
      expect(status).toBe(200);
      expect(body).toMatchObject({ language: 'es', displayName: 'Guillem' });
    });

    it('rejects a display name outside 2–40 characters and an empty patch', async () => {
      const short = await call<ErrorBody>(ADMIN, '/me', {
        method: 'PATCH',
        body: { displayName: 'G' },
      });
      expect(short.status).toBe(400);
      expect(short.body.error.code).toBe('VALIDATION');
      const empty = await call<ErrorBody>(ADMIN, '/me', { method: 'PATCH', body: {} });
      expect(empty.status).toBe(400);
    });

    it('is closed to applicants with NOT_APPROVED', async () => {
      await applicant(STRANGER);
      const { status, body } = await call<ErrorBody>(STRANGER, '/me', {
        method: 'PATCH',
        body: { language: 'es' },
      });
      expect(status).toBe(403);
      expect(body.error.code).toBe('NOT_APPROVED');
    });
  });

  describe('/admin/members (US-1.2, US-1.4)', () => {
    it('is closed to members who are not admins', async () => {
      const me = await applicant(STRANGER);
      await call(ADMIN, `/admin/members/${me.id}/approve`, { method: 'POST' });
      const { status, body } = await call<ErrorBody>(STRANGER, '/admin/members');
      expect(status).toBe(403);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('lists applicants and approves one, unlocking the app for them', async () => {
      const me = await applicant(STRANGER);
      const list = await call<AdminMembersResponse>(ADMIN, '/admin/members?status=pending');
      expect(list.status).toBe(200);
      expect(list.body.members.map((m) => m.id)).toEqual([me.id]);
      expect(list.body.members[0]?.appliedAt).toMatch(/^\d{4}-/);

      const approved = await call<MemberActionResponse>(ADMIN, `/admin/members/${me.id}/approve`, {
        method: 'POST',
      });
      expect(approved.status).toBe(200);
      expect(approved.body.member.status).toBe('approved');

      const patched = await call<Me>(STRANGER, '/me', {
        method: 'PATCH',
        body: { language: 'es' },
      });
      expect(patched.status).toBe(200);
    });

    it('a suspended member sees the suspended door on every call but GET /me', async () => {
      const me = await applicant(STRANGER);
      await call(ADMIN, `/admin/members/${me.id}/approve`, { method: 'POST' });
      await call(ADMIN, `/admin/members/${me.id}/suspend`, { method: 'POST' });

      const gate = await call<Me>(STRANGER, '/me');
      expect(gate.status).toBe(200);
      expect(gate.body.status).toBe('suspended');

      const blocked = await call<ErrorBody>(STRANGER, '/me', {
        method: 'PATCH',
        body: { language: 'es' },
      });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('SUSPENDED');
      const admin = await call<ErrorBody>(STRANGER, '/admin/members');
      expect(admin.status).toBe(403);
      expect(admin.body.error.code).toBe('SUSPENDED');
    });

    it('refuses to demote or suspend the last admin with 422 LAST_ADMIN', async () => {
      const admin = await applicant(ADMIN);
      const demote = await call<ErrorBody>(ADMIN, `/admin/members/${admin.id}/demote`, {
        method: 'POST',
      });
      expect(demote.status).toBe(422);
      expect(demote.body.error.code).toBe('LAST_ADMIN');
      expect(demote.body.error.message).toBe('No es pot deixar el grup sense cap administrador.');
      const suspend = await call<ErrorBody>(ADMIN, `/admin/members/${admin.id}/suspend`, {
        method: 'POST',
      });
      expect(suspend.status).toBe(422);
    });

    it('answers INVALID_TRANSITION for an action the state does not allow', async () => {
      const me = await applicant(STRANGER);
      const { status, body } = await call<ErrorBody>(ADMIN, `/admin/members/${me.id}/suspend`, {
        method: 'POST',
      });
      expect(status).toBe(422);
      expect(body.error.code).toBe('INVALID_TRANSITION');
    });

    it('404s an unknown action and a member that does not exist', async () => {
      const me = await applicant(STRANGER);
      expect((await call(ADMIN, `/admin/members/${me.id}/banish`, { method: 'POST' })).status).toBe(
        404,
      );
      expect(
        (
          await call(ADMIN, '/admin/members/00000000-0000-4000-8000-000000000000/approve', {
            method: 'POST',
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('/admin/invites (US-1.3)', () => {
    it('creates, lists and deletes a pre-approval', async () => {
      const created = await call<InviteResponse>(ADMIN, '/admin/invites', {
        method: 'POST',
        body: { identifier: '@Marta_Hort' },
      });
      expect(created.status).toBe(201);
      expect(created.body.invite).toMatchObject({ username: 'marta_hort', telegramId: null });

      const listed = await call<InvitesResponse>(ADMIN, '/admin/invites');
      expect(listed.body.invites).toHaveLength(1);

      const deleted = await call(ADMIN, `/admin/invites/${created.body.invite.id}`, {
        method: 'DELETE',
      });
      expect(deleted.status).toBe(204);
      expect((await call<InvitesResponse>(ADMIN, '/admin/invites')).body.invites).toHaveLength(0);
    });

    it('lets an invited id straight in when they first show up', async () => {
      await call(ADMIN, '/admin/invites', { method: 'POST', body: { identifier: OTHER } });
      const me = await applicant(OTHER);
      expect(me.status).toBe('approved');
      const listed = await call<InvitesResponse>(ADMIN, '/admin/invites');
      expect(listed.body.invites[0]?.usedAt).not.toBeNull();
    });

    it('rejects a bad identifier with 400 and a duplicate with 409', async () => {
      const bad = await call<ErrorBody>(ADMIN, '/admin/invites', {
        method: 'POST',
        body: { identifier: 'not a user' },
      });
      expect(bad.status).toBe(400);
      await call(ADMIN, '/admin/invites', { method: 'POST', body: { identifier: '@joanroca' } });
      const dup = await call<ErrorBody>(ADMIN, '/admin/invites', {
        method: 'POST',
        body: { identifier: 'joanroca' },
      });
      expect(dup.status).toBe(409);
    });
  });
});
