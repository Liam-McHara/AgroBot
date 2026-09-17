import { z } from 'zod';
import { MEMBER_ROLES, MEMBER_STATUSES } from '../enums.js';
import { languageSchema } from './common.js';

/**
 * PRD §10 "Members" and ARCH §11 `/admin/members`, `/admin/invites`.
 *
 * Admins see who applied and when, never more personal data than PRD §12 lists.
 */
export const adminMemberSchema = z.object({
  id: z.uuid(),
  telegramId: z.string(),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string(),
  language: languageSchema,
  role: z.enum(MEMBER_ROLES),
  status: z.enum(MEMBER_STATUSES),
  appliedAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
});
export type AdminMember = z.infer<typeof adminMemberSchema>;

export const adminMembersQuerySchema = z.object({
  status: z.enum(MEMBER_STATUSES).optional(),
});

export const adminMembersResponseSchema = z.object({
  members: z.array(adminMemberSchema),
});
export type AdminMembersResponse = z.infer<typeof adminMembersResponseSchema>;

/** ARCH §11: the six member actions share one response — the member as it is now. */
export const MEMBER_ACTIONS = [
  'approve',
  'reject',
  'suspend',
  'reinstate',
  'promote',
  'demote',
] as const;
export type MemberAction = (typeof MEMBER_ACTIONS)[number];

export const memberActionResponseSchema = z.object({ member: adminMemberSchema });
export type MemberActionResponse = z.infer<typeof memberActionResponseSchema>;

/** PRD US-1.3: a pre-approval by `@username` or Telegram id, one of the two. */
export const inviteSchema = z.object({
  id: z.uuid(),
  telegramId: z.string().nullable(),
  username: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdByName: z.string().nullable(),
  usedAt: z.iso.datetime().nullable(),
  usedByName: z.string().nullable(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const invitesResponseSchema = z.object({ invites: z.array(inviteSchema) });
export type InvitesResponse = z.infer<typeof invitesResponseSchema>;

/**
 * What an admin types: `@marta`, `marta` or `123456789`. Parsed by `parseInviteIdentifier`
 * on both sides so the form and the API agree on what is valid.
 */
export const createInviteSchema = z.object({
  identifier: z.string().trim().min(1).max(64),
});
export type CreateInvite = z.infer<typeof createInviteSchema>;

export const inviteResponseSchema = z.object({ invite: inviteSchema });
export type InviteResponse = z.infer<typeof inviteResponseSchema>;

export type InviteIdentifier =
  { kind: 'telegramId'; telegramId: string } | { kind: 'username'; username: string };

/** Telegram usernames: 5–32 characters, letters, digits and underscores. */
const USERNAME = /^@?([a-zA-Z][a-zA-Z0-9_]{4,31})$/;

/**
 * Digits are a Telegram id; anything else must look like a Telegram username, with or
 * without the `@`. Usernames are stored lower-case because Telegram treats them
 * case-insensitively.
 */
export function parseInviteIdentifier(raw: string): InviteIdentifier | null {
  const value = raw.trim();
  if (/^\d{1,20}$/.test(value)) return { kind: 'telegramId', telegramId: value };
  const match = USERNAME.exec(value);
  if (!match?.[1]) return null;
  return { kind: 'username', username: match[1].toLowerCase() };
}
