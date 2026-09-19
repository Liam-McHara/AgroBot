import type { NotificationKind, UnitCode } from '@agrobot/shared';

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

/** The product as it was named when the row was written, in both languages (ADR-0007). */
export interface OfferProductPayload {
  productName: string;
  productNameEs: string | null;
  unitCode: UnitCode;
}

/** PRD N3: a new or re-published offer, to every other member. */
export interface NewOfferPayload extends OfferProductPayload {
  offerId: string;
  producerName: string;
  /** What could be reserved when the row was written. */
  quantity: number;
  republished: boolean;
}

/** PRD N10: "still available?" to the producer, with the quantity the offer stands at. */
export interface OfferNudgePayload extends OfferProductPayload {
  offerId: string;
  quantity: number;
}

/** PRD N11: withdrawn with open reservations; the list the producer must resolve one by one. */
export interface OfferWithdrawnPayload extends OfferProductPayload {
  offerId: string;
  reservations: Array<{ requesterName: string; quantity: number }>;
}

export interface NotificationPayloads {
  N1: NewApplicantPayload;
  N2: MembershipDecidedPayload;
  N3: NewOfferPayload;
  N4: { productId: string; name: string };
  N5: { productId: string; name: string; decision: 'resolved' | 'rejected' };
  N10: OfferNudgePayload;
  N11: OfferWithdrawnPayload;
  N12: { syncId: string };
}

export type ImplementedNotificationKind = keyof NotificationPayloads & NotificationKind;
