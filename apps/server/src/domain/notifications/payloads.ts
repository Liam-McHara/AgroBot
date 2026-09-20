import type { NotificationKind, UnitCode } from '@agrobot/shared';

/**
 * What each notification kind of PRD §9 stores in `notifications.payload`. The renderer of
 * the same kind reads it back; both sides type against this file so a renamed field cannot
 * silently blank a message.
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

/** PRD N6–N8: the reservation as it stood when the row was written (PRD §8). */
export interface ReservationPayload extends OfferProductPayload {
  reservationId: string;
  offerId: string;
  quantity: number;
  /** The price snapshot; `null` while the product's price is pending (US-2.2). */
  unitPriceCents: number | null;
  requesterName: string;
  producerName: string;
}

/** PRD N7: the reservation is about to expire; when. */
export interface ReservationExpiringPayload extends ReservationPayload {
  expiresAt: string;
}

export type ReservationDecision = 'confirmed' | 'rejected' | 'cancelled' | 'delivered' | 'expired';

/**
 * PRD N8: the reservation changed state. `recipient` says which side reads it, so the text can
 * say "your reservation" to one and "the request" to the other; `actorName` is `null` when a
 * job or an admin's catalogue decision did it, and `cause` says which. ADR-0014: a delivered
 * row may come straight from `pending`, so nothing here assumes a previous status.
 */
export interface ReservationClosedPayload extends ReservationPayload {
  decision: ReservationDecision;
  recipient: 'requester' | 'producer';
  actorName: string | null;
  reason: string | null;
  cause: 'product_rejected' | null;
}

/**
 * PRD N9: the first message of an unread burst → the other party (US-5.1). One row per burst:
 * the `dedupe_key` of ARCH §8 step 3 stops the next ones until the recipient reads the thread.
 */
export interface NewChatMessagePayload extends OfferProductPayload {
  reservationId: string;
  senderName: string;
  quantity: number;
  /** The message that opened the burst, on one line, cut to `MESSAGE_PREVIEW_LENGTH`. */
  preview: string;
}

export interface NotificationPayloads {
  N1: NewApplicantPayload;
  N2: MembershipDecidedPayload;
  N3: NewOfferPayload;
  N4: { productId: string; name: string };
  N5: { productId: string; name: string; decision: 'resolved' | 'rejected' };
  N6: ReservationPayload;
  N7: ReservationExpiringPayload;
  N8: ReservationClosedPayload;
  N9: NewChatMessagePayload;
  N10: OfferNudgePayload;
  N11: OfferWithdrawnPayload;
  N12: { syncId: string };
}

export type ImplementedNotificationKind = keyof NotificationPayloads & NotificationKind;
