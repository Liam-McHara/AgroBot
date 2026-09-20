import {
  isDateBefore,
  type MemberStatus,
  type ReservationAction,
  type ReservationState,
  type ReservationStatus,
  type SystemLineMeta,
} from '@agrobot/shared';
import type { OfferSnapshot } from '../offers/rules.js';

/**
 * The pure part of reservations (PRD §8; ARCH §6 reservation machine). No database, no clock:
 * these functions decide, `service.ts` applies them inside transactions, and the bot's quick
 * actions and the API share them (ARCH §17).
 */

export type Party = 'requester' | 'producer';

/** Which side of a reservation a member is on, or `null` for everyone else (admins included). */
export function partyOf(
  reservation: { requesterId: string; producerId: string },
  memberId: string,
): Party | null {
  if (reservation.requesterId === memberId) return 'requester';
  if (reservation.producerId === memberId) return 'producer';
  return null;
}

export function otherParty(party: Party): Party {
  return party === 'producer' ? 'requester' : 'producer';
}

/**
 * ARCH §6, the transitions table as a party sees it: what they may ask for in this status.
 * `confirm-and-deliver` is the top row in one transaction (ADR-0014), so it is listed where
 * `confirm` is; the bot never offers it, the Mini App does.
 */
export function allowedActions(status: ReservationStatus, party: Party): ReservationAction[] {
  switch (status) {
    case 'pending':
      return party === 'producer' ? ['confirm', 'reject', 'confirm-and-deliver'] : ['cancel'];
    case 'confirmed':
      return ['deliver', 'cancel'];
    case 'delivered':
    case 'rejected':
    case 'cancelled':
    case 'expired':
      return [];
  }
}

export function canAct(
  status: ReservationStatus,
  party: Party,
  action: ReservationAction,
): boolean {
  return allowedActions(status, party).includes(action);
}

/**
 * Whether this party may take the action in *some* status. Tells a wrong actor (FORBIDDEN: a
 * requester pressing *Confirm*) from a stale button (INVALID_TRANSITION: the producer confirming
 * what was cancelled meanwhile), which PRD §9 wants answered differently.
 */
export function partyMayEver(party: Party, action: ReservationAction): boolean {
  switch (action) {
    case 'confirm':
    case 'reject':
    case 'confirm-and-deliver':
      return party === 'producer';
    case 'cancel':
    case 'deliver':
      return true;
  }
}

/** The status a successful action lands on. */
export function statusAfter(action: ReservationAction): ReservationStatus {
  switch (action) {
    case 'confirm':
      return 'confirmed';
    case 'reject':
      return 'rejected';
    case 'cancel':
      return 'cancelled';
    case 'deliver':
    case 'confirm-and-deliver':
      return 'delivered';
  }
}

/** PRD US-4.6: pending and confirmed are *active*; everything else is *closed*. */
export function stateOf(status: ReservationStatus): ReservationState {
  return status === 'pending' || status === 'confirmed' ? 'active' : 'closed';
}

export type NotReservable =
  'own_offer' | 'offer_not_active' | 'offer_past_date' | 'producer_not_approved';

/**
 * PRD US-4.1: "cannot reserve my own offer, an offer from a suspended producer, or an
 * expired/withdrawn offer". Availability is checked apart, because too little of it has its
 * own answer (`INSUFFICIENT_AVAILABILITY {available}`) and the UI offers to take what is left.
 */
export function whyNotReservable(
  offer: Pick<OfferSnapshot, 'status' | 'availableUntil'> & {
    producerId: string;
    producerStatus: MemberStatus;
  },
  requesterId: string,
  today: string,
): NotReservable | null {
  if (offer.producerId === requesterId) return 'own_offer';
  if (offer.status !== 'active') return 'offer_not_active';
  if (offer.availableUntil !== null && isDateBefore(offer.availableUntil, today)) {
    return 'offer_past_date';
  }
  if (offer.producerStatus !== 'approved') return 'producer_not_approved';
  return null;
}

const HOUR_MS = 3_600_000;

/** PRD US-4.1: `expires_at = now + reservation_expiry_hours`. Fractions of an hour are fine. */
export function expiresAtFor(at: Date, expiryHours: number): Date {
  return new Date(at.getTime() + expiryHours * HOUR_MS);
}

/** PRD US-4.5: the producer is reminded this long before `expires_at`. */
export function reminderAtFor(expiresAt: Date, reminderHours: number): Date {
  return new Date(expiresAt.getTime() - reminderHours * HOUR_MS);
}

/** ARCH §6 `remind`: pending, not yet reminded, inside the reminder window. */
export function isReminderDue(
  reservation: { status: ReservationStatus; remindedAt: Date | null; expiresAt: Date | null },
  at: Date,
  reminderHours: number,
): boolean {
  return (
    reservation.status === 'pending' &&
    reservation.remindedAt === null &&
    reservation.expiresAt !== null &&
    reminderAtFor(reservation.expiresAt, reminderHours).getTime() <= at.getTime()
  );
}

/** ARCH §6 `expire`: pending and past `expires_at`. */
export function isExpiryDue(
  reservation: { status: ReservationStatus; expiresAt: Date | null },
  at: Date,
): boolean {
  return (
    reservation.status === 'pending' &&
    reservation.expiresAt !== null &&
    reservation.expiresAt.getTime() <= at.getTime()
  );
}

/**
 * What a system line stores in `messages.meta` (ARCH §5): the transition and who caused it,
 * as the shared `systemLineMetaSchema` describes it so the Mini App renders it in the reader's
 * language (PRD US-5.1). `actorId` is `null` when a job or an admin's catalogue decision did it,
 * and `cause` says which.
 */
export type { SystemLineMeta };
