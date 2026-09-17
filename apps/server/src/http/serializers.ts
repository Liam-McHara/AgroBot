import type { AdminMember, Invite, Me, Settings } from '@agrobot/shared';
import type { Member } from '../db/schema/index.js';
import type { InviteView } from '../domain/members/service.js';

/** Rows → the shared contracts. Nothing leaves the API that is not in a schema. */

export function toMe(member: Member, settings: Settings): Me {
  return {
    id: member.id,
    telegramId: String(member.telegramId),
    username: member.username,
    displayName: member.displayName,
    language: member.language,
    role: member.role,
    status: member.status,
    settings,
  };
}

export function toAdminMember(member: Member): AdminMember {
  return {
    id: member.id,
    telegramId: String(member.telegramId),
    username: member.username,
    firstName: member.firstName,
    lastName: member.lastName,
    displayName: member.displayName,
    language: member.language,
    role: member.role,
    status: member.status,
    appliedAt: member.appliedAt.toISOString(),
    approvedAt: member.approvedAt?.toISOString() ?? null,
    lastSeenAt: member.lastSeenAt?.toISOString() ?? null,
  };
}

export function toInvite(invite: InviteView): Invite {
  return {
    id: invite.id,
    telegramId: invite.telegramId === null ? null : String(invite.telegramId),
    username: invite.username,
    createdAt: invite.createdAt.toISOString(),
    createdByName: invite.createdByName,
    usedAt: invite.usedAt?.toISOString() ?? null,
    usedByName: invite.usedByName,
  };
}
