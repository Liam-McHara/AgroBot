import type { ErrorCode, Language, MemberAction, MemberRole, MemberStatus } from '@agrobot/shared';

/**
 * The pure part of membership (PRD §2, §5; ARCH §6 member machine). No database, no clock:
 * these functions decide, the service in `service.ts` applies.
 */

/** What Telegram tells us about a person, whichever door they came through. */
export interface TelegramIdentity {
  id: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  language: Language;
}

export interface MemberState {
  status: MemberStatus;
  role: MemberRole;
}

/** PRD US-1.5: display name defaults to Telegram first + last name, 2–40 characters. */
export function displayNameFrom(identity: TelegramIdentity): string {
  const parts = [identity.firstName, identity.lastName].filter((part): part is string =>
    Boolean(part && part.trim()),
  );
  const candidate = (
    parts.length > 0 ? parts.join(' ') : (identity.username ?? `Telegram ${identity.id}`)
  )
    .trim()
    .slice(0, 40);
  return candidate.length >= 2 ? candidate : `Telegram ${identity.id}`;
}

export type AutoApproval = 'admin' | 'invite' | null;

/**
 * PRD US-1.1: an id in `ADMIN_TELEGRAM_IDS` is approved as admin, an id or `@username` on the
 * pre-approved list (US-1.3) is approved as member. Configuration wins over invites.
 */
export function resolveAutoApproval(
  identity: Pick<TelegramIdentity, 'id'>,
  options: { adminTelegramIds: readonly string[]; hasInvite: boolean },
): AutoApproval {
  if (options.adminTelegramIds.includes(String(identity.id))) return 'admin';
  if (options.hasInvite) return 'invite';
  return null;
}

/**
 * ARCH §6: `pending → approved → suspended ⇄ approved`, `pending → rejected`,
 * `rejected → approved`; role `member ⇄ admin` orthogonal to status (only for approved
 * members — promoting someone who is not in makes no sense). Returns the state after the
 * action or `null` when the action does not apply to the current state.
 */
export function applyMemberAction(state: MemberState, action: MemberAction): MemberState | null {
  switch (action) {
    case 'approve':
      return state.status === 'pending' || state.status === 'rejected'
        ? { ...state, status: 'approved' }
        : null;
    case 'reject':
      return state.status === 'pending' ? { ...state, status: 'rejected' } : null;
    case 'suspend':
      return state.status === 'approved' ? { ...state, status: 'suspended' } : null;
    case 'reinstate':
      return state.status === 'suspended' ? { ...state, status: 'approved' } : null;
    case 'promote':
      return state.status === 'approved' && state.role === 'member'
        ? { ...state, role: 'admin' }
        : null;
    case 'demote':
      return state.role === 'admin' ? { ...state, role: 'member' } : null;
  }
}

/**
 * PRD US-1.4: the group can never be left without an admin. An action that would take the
 * last approved admin out of the admin seat (suspending or demoting them) is refused.
 */
export function wouldRemoveLastAdmin(
  target: MemberState,
  action: MemberAction,
  approvedAdminCount: number,
): boolean {
  const isActiveAdmin = target.role === 'admin' && target.status === 'approved';
  if (!isActiveAdmin) return false;
  if (action !== 'suspend' && action !== 'demote') return false;
  return approvedAdminCount <= 1;
}

/** PRD §2: what stops a non-member at the door, as an error code, or `null` for members. */
export function gateErrorFor(state: Pick<MemberState, 'status'>): ErrorCode | null {
  switch (state.status) {
    case 'approved':
      return null;
    case 'suspended':
      return 'SUSPENDED';
    case 'pending':
    case 'rejected':
      return 'NOT_APPROVED';
  }
}

export function isActiveAdmin(state: MemberState): boolean {
  return state.status === 'approved' && state.role === 'admin';
}
