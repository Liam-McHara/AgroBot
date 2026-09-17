import type { NotificationKind } from '@agrobot/shared';

/**
 * What each notification kind of PRD §9 stores in `notifications.payload`. The renderer of
 * the same kind reads it back; both sides type against this file so a renamed field cannot
 * silently blank a message.
 *
 * Only the kinds implemented so far are typed; the rest are added milestone by milestone.
 */
export interface NewApplicantPayload {
  applicantId: string;
  /** Display name at the time of applying; shown even if they rename later. */
  name: string;
  username: string | null;
}

export interface MembershipDecidedPayload {
  decision: 'approved' | 'rejected';
  name: string;
}

export interface NotificationPayloads {
  N1: NewApplicantPayload;
  N2: MembershipDecidedPayload;
  N4: { productId: string; name: string };
  N5: { productId: string; name: string; decision: 'resolved' | 'rejected' };
  N12: { syncId: string };
}

export type ImplementedNotificationKind = keyof NotificationPayloads & NotificationKind;
