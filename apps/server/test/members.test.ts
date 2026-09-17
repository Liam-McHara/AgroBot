import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { memberInvites, members, notifications } from '../src/db/schema/index.js';
import { createMembersService, type MembersService } from '../src/domain/members/service.js';
import type { TelegramIdentity } from '../src/domain/members/rules.js';
import { isAppError } from '../src/errors.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

const ADMIN_ID = 1001;
const identity = (id: number, extra: Partial<TelegramIdentity> = {}): TelegramIdentity => ({
  id,
  username: `user${id}`,
  firstName: `First${id}`,
  lastName: null,
  language: 'ca',
  ...extra,
});

async function notificationsFor(memberId: string) {
  return database!.db.select().from(notifications).where(eq(notifications.memberId, memberId));
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(isAppError(error) && error.code, `expected ${code}`).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but it resolved`);
}

suite('domain/members', () => {
  let service: MembersService;

  beforeEach(async () => {
    await resetDatabase(database!);
    service = createMembersService({ db: database!.db, adminTelegramIds: [String(ADMIN_ID)] });
  });

  afterAll(async () => {
    await database?.close();
  });

  async function bootstrapAdmin() {
    const { member } = await service.identify(identity(ADMIN_ID));
    return member;
  }

  describe('identify (US-1.1)', () => {
    it('bootstraps a configured id as an approved admin, without notifying anyone', async () => {
      const result = await service.identify(identity(ADMIN_ID));
      expect(result).toMatchObject({ created: true, autoApproved: 'admin' });
      expect(result.member).toMatchObject({ role: 'admin', status: 'approved' });
      expect(result.member.approvedAt).not.toBeNull();
      expect(await database!.db.select().from(notifications)).toHaveLength(0);
    });

    it('creates a stranger as applicant and queues N1 for every admin', async () => {
      const admin = await bootstrapAdmin();
      const result = await service.identify(identity(2001, { lastName: 'Puig' }));
      expect(result).toMatchObject({ created: true, autoApproved: null });
      expect(result.member).toMatchObject({
        status: 'pending',
        role: 'member',
        displayName: 'First2001 Puig',
      });

      const queued = await notificationsFor(admin.id);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        kind: 'N1',
        status: 'queued',
        payload: { applicantId: result.member.id, name: 'First2001 Puig', username: 'user2001' },
      });
    });

    it('does not notify admins again when the applicant comes back', async () => {
      const admin = await bootstrapAdmin();
      await service.identify(identity(2001));
      const again = await service.identify(identity(2001, { username: 'renamed' }));
      expect(again.created).toBe(false);
      expect(again.member.username).toBe('renamed');
      expect(await notificationsFor(admin.id)).toHaveLength(1);
      expect(
        await database!.db.select().from(members).where(eq(members.telegramId, 2001)),
      ).toHaveLength(1);
    });

    it('approves an invited username on arrival and marks the invite used (US-1.3)', async () => {
      const admin = await bootstrapAdmin();
      await service.createInvite(admin, '@Marta_Hort');
      const result = await service.identify(identity(2002, { username: 'marta_hort' }));
      expect(result).toMatchObject({ created: true, autoApproved: 'invite' });
      expect(result.member).toMatchObject({ status: 'approved', role: 'member' });

      const [invite] = await database!.db.select().from(memberInvites);
      expect(invite).toMatchObject({ usedBy: result.member.id });
      expect(invite?.usedAt).not.toBeNull();
      // No N1: there was nothing for the admins to decide.
      expect(await notificationsFor(admin.id)).toHaveLength(0);
    });

    it('approves an invited Telegram id even without a username', async () => {
      const admin = await bootstrapAdmin();
      await service.createInvite(admin, '2003');
      const result = await service.identify(identity(2003, { username: null }));
      expect(result.autoApproved).toBe('invite');
    });

    it('lets a waiting applicant in as soon as configuration covers them', async () => {
      await bootstrapAdmin();
      const first = await service.identify(identity(2004));
      expect(first.member.status).toBe('pending');
      const promoted = createMembersService({
        db: database!.db,
        adminTelegramIds: [String(ADMIN_ID), '2004'],
      });
      const second = await promoted.identify(identity(2004));
      expect(second).toMatchObject({ created: false, autoApproved: 'admin' });
      expect(second.member).toMatchObject({ status: 'approved', role: 'admin' });
    });

    it('never re-approves a suspended or rejected member from configuration', async () => {
      const admin = await bootstrapAdmin();
      const { member } = await service.identify(identity(2005));
      await service.reject(admin, member.id);
      const configured = createMembersService({
        db: database!.db,
        adminTelegramIds: [String(ADMIN_ID), '2005'],
      });
      const again = await configured.identify(identity(2005));
      expect(again.member.status).toBe('rejected');
    });
  });

  describe('admin actions (US-1.2, US-1.4)', () => {
    it('approve queues N2 and records who approved', async () => {
      const admin = await bootstrapAdmin();
      const { member } = await service.identify(identity(2010));
      const approved = await service.approve(admin, member.id);
      expect(approved).toMatchObject({ status: 'approved', approvedBy: admin.id });
      const queued = await notificationsFor(member.id);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ kind: 'N2', payload: { decision: 'approved' } });
    });

    it('reject queues N2 and keeps the record so a repeat Start is quiet', async () => {
      const admin = await bootstrapAdmin();
      const { member } = await service.identify(identity(2011));
      await service.reject(admin, member.id);
      const again = await service.identify(identity(2011));
      expect(again.member.status).toBe('rejected');
      expect(await notificationsFor(admin.id)).toHaveLength(1); // the original N1 only
      expect((await notificationsFor(member.id))[0]).toMatchObject({
        kind: 'N2',
        payload: { decision: 'rejected' },
      });
    });

    it('an admin may approve someone they rejected earlier', async () => {
      const admin = await bootstrapAdmin();
      const { member } = await service.identify(identity(2012));
      await service.reject(admin, member.id);
      expect((await service.approve(admin, member.id)).status).toBe('approved');
    });

    it('suspend, reinstate, promote and demote follow the member machine', async () => {
      const admin = await bootstrapAdmin();
      const { member } = await service.identify(identity(2013));
      await service.approve(admin, member.id);
      expect((await service.suspend(admin, member.id)).status).toBe('suspended');
      expect((await service.reinstate(admin, member.id)).status).toBe('approved');
      expect((await service.promote(admin, member.id)).role).toBe('admin');
      expect((await service.demote(admin, member.id)).role).toBe('member');
    });

    it('refuses a transition that does not exist with INVALID_TRANSITION', async () => {
      const admin = await bootstrapAdmin();
      const { member } = await service.identify(identity(2014));
      await expectAppError(service.suspend(admin, member.id), 'INVALID_TRANSITION');
      await expectAppError(service.promote(admin, member.id), 'INVALID_TRANSITION');
      await service.approve(admin, member.id);
      await expectAppError(service.approve(admin, member.id), 'INVALID_TRANSITION');
    });

    it('never lets the last admin be suspended or demoted', async () => {
      const admin = await bootstrapAdmin();
      await expectAppError(service.demote(admin, admin.id), 'LAST_ADMIN');
      await expectAppError(service.suspend(admin, admin.id), 'LAST_ADMIN');

      const { member: other } = await service.identify(identity(2015));
      await service.approve(admin, other.id);
      await service.promote(admin, other.id);
      // Two admins now: stepping down is fine.
      expect((await service.demote(admin, admin.id)).role).toBe('member');
      // …and the remaining one is the last again.
      const otherNow = (await service.getById(other.id))!;
      await expectAppError(service.suspend(otherNow, other.id), 'LAST_ADMIN');
    });

    it('refuses actors who are not approved admins', async () => {
      const admin = await bootstrapAdmin();
      const { member: plain } = await service.identify(identity(2016));
      const { member: target } = await service.identify(identity(2017));
      await expectAppError(service.approve(plain, target.id), 'NOT_APPROVED');
      const approvedPlain = await service.approve(admin, plain.id);
      await expectAppError(service.approve(approvedPlain, target.id), 'FORBIDDEN');
      const suspendedPlain = await service.suspend(admin, plain.id);
      await expectAppError(service.approve(suspendedPlain, target.id), 'SUSPENDED');
    });

    it('checks the actor against the database, not against a stale copy', async () => {
      const admin = await bootstrapAdmin();
      const { member: other } = await service.identify(identity(2018));
      await service.approve(admin, other.id);
      const otherAsAdmin = await service.promote(admin, other.id);
      await service.demote(admin, other.id);
      // `otherAsAdmin` still says admin; the row says member.
      await expectAppError(service.suspend(otherAsAdmin, admin.id), 'FORBIDDEN');
    });

    it('answers NOT_FOUND for an unknown member', async () => {
      const admin = await bootstrapAdmin();
      await expectAppError(
        service.approve(admin, '00000000-0000-4000-8000-000000000000'),
        'NOT_FOUND',
      );
    });
  });

  describe('invites (US-1.3)', () => {
    it('lists invites with who created and who used them', async () => {
      const admin = await bootstrapAdmin();
      const invite = await service.createInvite(admin, '@perenadal');
      expect(invite).toMatchObject({
        username: 'perenadal',
        telegramId: null,
        createdByName: admin.displayName,
      });
      await service.identify(identity(2020, { username: 'PereNadal' }));
      const [listed] = await service.listInvites(admin);
      expect(listed).toMatchObject({ username: 'perenadal', usedByName: 'First2020' });
    });

    it('approves a waiting applicant on the spot and tells them (N2)', async () => {
      const admin = await bootstrapAdmin();
      const { member } = await service.identify(identity(2021, { username: 'annasoler' }));
      const invite = await service.createInvite(admin, '@annasoler');
      expect(invite.usedBy).toBe(member.id);
      const [row] = await database!.db.select().from(members).where(eq(members.id, member.id));
      expect(row).toMatchObject({ status: 'approved', approvedBy: admin.id });
      expect((await notificationsFor(member.id))[0]).toMatchObject({
        kind: 'N2',
        payload: { decision: 'approved' },
      });
    });

    it('refuses to invite someone who is already in, and a duplicate', async () => {
      const admin = await bootstrapAdmin();
      await expectAppError(service.createInvite(admin, String(ADMIN_ID)), 'CONFLICT');
      await service.createInvite(admin, '@joanroca');
      await expectAppError(service.createInvite(admin, 'JOANROCA'), 'CONFLICT');
    });

    it('refuses an identifier that is neither an id nor a username', async () => {
      const admin = await bootstrapAdmin();
      await expectAppError(service.createInvite(admin, 'not a user'), 'VALIDATION');
    });

    it('deletes an invite once, then NOT_FOUND', async () => {
      const admin = await bootstrapAdmin();
      const invite = await service.createInvite(admin, '@laiavila');
      await service.deleteInvite(admin, invite.id);
      await expectAppError(service.deleteInvite(admin, invite.id), 'NOT_FOUND');
    });
  });

  describe('profile (US-1.5)', () => {
    it('updates language and display name', async () => {
      const admin = await bootstrapAdmin();
      const updated = await service.updateProfile(admin, {
        language: 'es',
        displayName: 'Guillem',
      });
      expect(updated).toMatchObject({ language: 'es', displayName: 'Guillem' });
    });

    it('is closed to applicants', async () => {
      await bootstrapAdmin();
      const { member } = await service.identify(identity(2030));
      await expectAppError(service.updateProfile(member, { language: 'es' }), 'NOT_APPROVED');
    });
  });
});
