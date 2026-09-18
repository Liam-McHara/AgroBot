import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { parseInviteIdentifier, type MemberAction, type MemberStatus } from '@agrobot/shared';
import type { Database, Executor } from '../../db/client.js';
import { memberInvites, members, type Member, type MemberInvite } from '../../db/schema/index.js';
import {
  AppError,
  conflict,
  forbidden,
  invalidTransition,
  notFound,
  validationFailed,
} from '../../errors.js';
import { enqueueNotification, enqueueNotifications } from '../notifications/outbox.js';
import { noopHub, type HubPort } from '../ports.js';
import {
  applyMemberAction,
  displayNameFrom,
  gateErrorFor,
  isActiveAdmin,
  resolveAutoApproval,
  wouldRemoveLastAdmin,
  type TelegramIdentity,
} from './rules.js';

/**
 * Membership (PRD §2, §5; ARCH §4, §6). Every state change runs in one transaction with the
 * notification rows it produces (ADR-0009), and every authorization check lives here so the
 * API routes and the bot quick actions share it (ARCH §17).
 */
export interface MembersServiceDeps {
  db: Database;
  /** ARCH §13 `ADMIN_TELEGRAM_IDS`: approved as admins the moment they show up. */
  adminTelegramIds: readonly string[];
  /** ADR-0017: woken after commits that enqueue, told after commits members should see. */
  hub?: HubPort;
  now?: () => Date;
}

export interface IdentifyResult {
  member: Member;
  /** True when this call created the row: the person just applied (or was auto-approved). */
  created: boolean;
  /** Set when this call approved them without an admin: `admin` (config) or `invite`. */
  autoApproved: 'admin' | 'invite' | null;
}

export interface InviteView extends MemberInvite {
  createdByName: string | null;
  usedByName: string | null;
}

export type MembersService = ReturnType<typeof createMembersService>;

/** PRD §2 guards, usable from routes (`requireMember`) and from bot handlers alike. */
export function assertMember(member: Member): void {
  const code = gateErrorFor(member);
  if (code) throw new AppError(code);
}

export function assertAdmin(member: Member): void {
  assertMember(member);
  if (!isActiveAdmin(member)) throw forbidden({ reason: 'admin_required' });
}

export function createMembersService(deps: MembersServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const hub = deps.hub ?? noopHub;

  async function findOpenInvite(
    tx: Executor,
    identity: Pick<TelegramIdentity, 'id' | 'username'>,
  ): Promise<MemberInvite | null> {
    const byUsername = identity.username?.toLowerCase();
    const [invite] = await tx
      .select()
      .from(memberInvites)
      .where(
        and(
          isNull(memberInvites.usedAt),
          byUsername
            ? or(
                eq(memberInvites.telegramId, identity.id),
                eq(sql`lower(${memberInvites.username})`, byUsername),
              )
            : eq(memberInvites.telegramId, identity.id),
        ),
      )
      .limit(1)
      .for('update');
    return invite ?? null;
  }

  async function approvedAdminIds(tx: Executor): Promise<string[]> {
    const rows = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.role, 'admin'), eq(members.status, 'approved')));
    return rows.map((row) => row.id);
  }

  async function lockMember(tx: Executor, memberId: string): Promise<Member> {
    const [row] = await tx.select().from(members).where(eq(members.id, memberId)).for('update');
    if (!row) throw notFound({ memberId });
    return row;
  }

  /**
   * Who is knocking. Creates an applicant for a stranger (US-1.1), approves them on the spot
   * when configuration or an invite says so, keeps the Telegram fields in step and notifies
   * the admins (N1) of a new applicant — through whichever door they came, `/start` or the
   * Mini App.
   */
  async function identify(identity: TelegramIdentity): Promise<IdentifyResult> {
    const result = await deps.db.transaction(async (tx) => {
      const at = now();
      const invite = await findOpenInvite(tx, identity);
      const autoApproval = resolveAutoApproval(identity, {
        adminTelegramIds: deps.adminTelegramIds,
        hasInvite: invite !== null,
      });

      const [existing] = await tx
        .select()
        .from(members)
        .where(eq(members.telegramId, identity.id))
        .for('update');

      let member: Member;
      let created = false;
      let autoApproved: IdentifyResult['autoApproved'] = null;

      if (!existing) {
        const [inserted] = await tx
          .insert(members)
          .values({
            telegramId: identity.id,
            username: identity.username,
            firstName: identity.firstName,
            lastName: identity.lastName,
            displayName: displayNameFrom(identity),
            language: identity.language,
            role: autoApproval === 'admin' ? 'admin' : 'member',
            status: autoApproval ? 'approved' : 'pending',
            appliedAt: at,
            approvedAt: autoApproval ? at : null,
            lastSeenAt: at,
            createdAt: at,
            updatedAt: at,
          })
          .onConflictDoNothing({ target: members.telegramId })
          .returning();
        if (inserted) {
          member = inserted;
          created = true;
          autoApproved = autoApproval;
        } else {
          // Lost a race with a parallel request from the same person: take theirs.
          member = await lockMemberByTelegramId(tx, identity.id);
        }
      } else {
        member = existing;
      }

      if (!created) {
        const patch: Partial<typeof members.$inferInsert> = {
          username: identity.username,
          firstName: identity.firstName,
          lastName: identity.lastName,
          lastSeenAt: at,
        };
        // A pending applicant is approved the moment configuration or an invite covers them
        // (US-1.1, US-1.3), so an invite added after they applied still lets them in.
        if (member.status === 'pending' && autoApproval) {
          patch.status = 'approved';
          patch.approvedAt = at;
          if (autoApproval === 'admin') patch.role = 'admin';
          autoApproved = autoApproval;
        }
        const changed =
          member.username !== identity.username ||
          member.firstName !== identity.firstName ||
          member.lastName !== identity.lastName ||
          autoApproved !== null;
        if (changed) patch.updatedAt = at;
        const [updated] = await tx
          .update(members)
          .set(patch)
          .where(eq(members.id, member.id))
          .returning();
        member = updated ?? member;
      }

      if (autoApproved === 'invite' && invite) {
        await tx
          .update(memberInvites)
          .set({ usedBy: member.id, usedAt: at })
          .where(eq(memberInvites.id, invite.id));
      }

      if (created && !autoApproved) {
        await enqueueNotifications(tx, await approvedAdminIds(tx), 'N1', {
          applicantId: member.id,
          name: member.displayName,
          username: member.username,
        });
      }

      return { member, created, autoApproved };
    });
    // ARCH §8 step 2: N1 is committed with the applicant row; the hub drains it within a second.
    if (result.created && !result.autoApproved) hub.wake();
    return result;
  }

  async function lockMemberByTelegramId(tx: Executor, telegramId: number): Promise<Member> {
    const [row] = await tx
      .select()
      .from(members)
      .where(eq(members.telegramId, telegramId))
      .for('update');
    if (!row) throw new Error(`member ${telegramId} vanished inside the transaction`);
    return row;
  }

  /**
   * US-1.2, US-1.4: one of the six admin actions. Guards: the actor is an approved admin,
   * the transition exists (ARCH §6), and the last admin stays (PRD US-1.4). Approving or
   * rejecting queues N2 for the person concerned.
   */
  async function act(actor: Member, memberId: string, action: MemberAction): Promise<Member> {
    assertAdmin(actor);
    const member = await deps.db.transaction(async (tx) => {
      const at = now();
      // Every approved admin is locked while we count them, so two parallel demotions
      // cannot both see "two admins left".
      const admins = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.role, 'admin'), eq(members.status, 'approved')))
        .for('update');
      // The caller's copy of the actor may predate a demotion; the row is the truth.
      assertAdmin(await lockMember(tx, actor.id));
      const target = await lockMember(tx, memberId);

      const next = applyMemberAction(target, action);
      if (!next) throw invalidTransition({ action, status: target.status, role: target.role });
      if (wouldRemoveLastAdmin(target, action, admins.length)) throw new AppError('LAST_ADMIN');

      const patch: Partial<typeof members.$inferInsert> = {
        status: next.status,
        role: next.role,
        updatedAt: at,
      };
      if (action === 'approve') {
        patch.approvedAt = at;
        patch.approvedBy = actor.id;
      }
      const [updated] = await tx
        .update(members)
        .set(patch)
        .where(eq(members.id, target.id))
        .returning();
      const member = updated!;

      if (action === 'approve' || action === 'reject') {
        await enqueueNotification(tx, {
          memberId: member.id,
          kind: 'N2',
          payload: {
            decision: action === 'approve' ? 'approved' : 'rejected',
            name: member.displayName,
          },
        });
      }
      return member;
    });
    if (action === 'approve' || action === 'reject') hub.wake();
    // ARCH §7: their open Mini App refetches `/me` and shows the new status or role at once.
    hub.publish([member.id], { type: 'me.changed' });
    return member;
  }

  /** US-1.5: language and display name are the member's to change. */
  async function updateProfile(
    member: Member,
    patch: { language?: Member['language'] | undefined; displayName?: string | undefined },
  ): Promise<Member> {
    assertMember(member);
    const [updated] = await deps.db
      .update(members)
      .set({
        ...(patch.language === undefined ? {} : { language: patch.language }),
        ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
        updatedAt: now(),
      })
      .where(eq(members.id, member.id))
      .returning();
    // ARCH §7: `me.changed` on `PATCH /me` is what proves the realtime path end to end.
    hub.publish([member.id], { type: 'me.changed' });
    return updated ?? member;
  }

  async function getById(memberId: string): Promise<Member | null> {
    const [row] = await deps.db.select().from(members).where(eq(members.id, memberId));
    return row ?? null;
  }

  /** PRD §10: applicants newest first; everyone else by name. */
  async function list(actor: Member, status?: MemberStatus): Promise<Member[]> {
    assertAdmin(actor);
    const query = deps.db.select().from(members);
    if (status) {
      return query
        .where(eq(members.status, status))
        .orderBy(status === 'pending' ? desc(members.appliedAt) : asc(members.displayName));
    }
    return query.orderBy(asc(members.displayName));
  }

  async function listInvites(actor: Member): Promise<InviteView[]> {
    assertAdmin(actor);
    return inviteViews(deps.db);
  }

  async function inviteViews(tx: Executor, inviteId?: string): Promise<InviteView[]> {
    const rows = await tx.execute<InviteView & Record<string, unknown>>(sql`
      select i.id, i.telegram_id as "telegramId", i.username, i.created_by as "createdBy",
             i.created_at as "createdAt", i.used_by as "usedBy", i.used_at as "usedAt",
             c.display_name as "createdByName", u.display_name as "usedByName"
      from member_invites i
      left join members c on c.id = i.created_by
      left join members u on u.id = i.used_by
      ${inviteId ? sql`where i.id = ${inviteId}` : sql``}
      order by i.created_at desc
    `);
    return [...rows].map((row) => ({
      ...row,
      telegramId: row.telegramId === null ? null : Number(row.telegramId),
      createdAt: new Date(row.createdAt as unknown as string),
      usedAt: row.usedAt ? new Date(row.usedAt as unknown as string) : null,
    }));
  }

  /**
   * US-1.3: pre-approve by `@username` or Telegram id. Someone already waiting under that
   * identity is approved right away (with N2) and the invite is recorded as used by them;
   * someone already in is a conflict, not a second membership.
   */
  async function createInvite(actor: Member, rawIdentifier: string): Promise<InviteView> {
    assertAdmin(actor);
    const identifier = parseInviteIdentifier(rawIdentifier);
    if (!identifier) throw validationFailed({ field: 'identifier' });

    const { view, approved } = await deps.db.transaction(async (tx) => {
      const at = now();
      const [existingMember] = await tx
        .select()
        .from(members)
        .where(
          identifier.kind === 'telegramId'
            ? eq(members.telegramId, Number(identifier.telegramId))
            : eq(sql`lower(${members.username})`, identifier.username),
        )
        .for('update');

      if (
        existingMember &&
        existingMember.status !== 'pending' &&
        existingMember.status !== 'rejected'
      ) {
        throw conflict({ reason: 'already_member', memberId: existingMember.id });
      }

      const [invite] = await tx
        .insert(memberInvites)
        .values({
          telegramId: identifier.kind === 'telegramId' ? Number(identifier.telegramId) : null,
          username: identifier.kind === 'username' ? identifier.username : null,
          createdBy: actor.id,
          createdAt: at,
        })
        .onConflictDoNothing()
        .returning();
      if (!invite) throw conflict({ reason: 'already_invited' });

      if (existingMember) {
        await tx
          .update(members)
          .set({ status: 'approved', approvedAt: at, approvedBy: actor.id, updatedAt: at })
          .where(eq(members.id, existingMember.id));
        await tx
          .update(memberInvites)
          .set({ usedBy: existingMember.id, usedAt: at })
          .where(eq(memberInvites.id, invite.id));
        await enqueueNotification(tx, {
          memberId: existingMember.id,
          kind: 'N2',
          payload: { decision: 'approved', name: existingMember.displayName },
        });
      }

      const [view] = await inviteViews(tx, invite.id);
      return { view: view!, approved: existingMember ? existingMember.id : null };
    });
    if (approved) {
      hub.wake();
      hub.publish([approved], { type: 'me.changed' });
    }
    return view;
  }

  async function deleteInvite(actor: Member, inviteId: string): Promise<void> {
    assertAdmin(actor);
    const deleted = await deps.db
      .delete(memberInvites)
      .where(eq(memberInvites.id, inviteId))
      .returning({ id: memberInvites.id });
    if (deleted.length === 0) throw notFound({ inviteId });
  }

  return {
    identify,
    act,
    approve: (actor: Member, id: string) => act(actor, id, 'approve'),
    reject: (actor: Member, id: string) => act(actor, id, 'reject'),
    suspend: (actor: Member, id: string) => act(actor, id, 'suspend'),
    reinstate: (actor: Member, id: string) => act(actor, id, 'reinstate'),
    promote: (actor: Member, id: string) => act(actor, id, 'promote'),
    demote: (actor: Member, id: string) => act(actor, id, 'demote'),
    updateProfile,
    getById,
    list,
    listInvites,
    createInvite,
    deleteInvite,
  };
}
