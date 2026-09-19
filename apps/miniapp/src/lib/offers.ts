import {
  isQuantityOnStep,
  localDateString,
  type Language,
  type MyOfferView,
  type OfferDetailView,
  type OfferView,
  type UnitCode,
} from '@agrobot/shared';

/** Pure helpers the offer screens share (PRD §7). */

/** The product name in the member's language, falling back to the main one (PRD US-2.1). */
export function productLabel(
  product: { name: string; nameEs: string | null },
  language: Language,
): string {
  return language === 'es' ? product.nameEs || product.name : product.name;
}

/**
 * PRD US-3.2, US-3.4: what the producer's row says about an offer, most important first.
 * `active` means nothing to flag.
 */
export type MyOfferState =
  'withdrawn' | 'expired' | 'fully_reserved' | 'stale' | 'nudged' | 'active';

export function myOfferState(
  offer: Pick<OfferView, 'status' | 'available' | 'stale'> & { nudgedAt: string | null },
): MyOfferState {
  if (offer.status === 'withdrawn') return 'withdrawn';
  if (offer.status === 'expired') return 'expired';
  if (offer.available <= 0) return 'fully_reserved';
  if (offer.stale) return 'stale';
  if (offer.nudgedAt !== null) return 'nudged';
  return 'active';
}

/** Whether the detail of `GET /offers/:id` belongs to the viewer: totals are only theirs. */
export function isMine(offer: OfferDetailView): offer is OfferDetailView & MyOfferView {
  return offer.quantity !== null && offer.held !== null && offer.openReservations !== null;
}

/** Today on the farm, for the `min` of a date input and the client-side date check. */
export function todayOnFarm(now: Date = new Date()): string {
  return localDateString(now);
}

export interface QuantityCheck {
  ok: boolean;
  /** Why not: off the unit's step, below what is held, or not positive. */
  reason: 'step' | 'below_held' | 'zero' | null;
}

/**
 * PRD US-3.1, US-3.2: the same rules the server applies, so the form disables the button
 * instead of earning a 400 or a 422. `minimum` is 0 when editing (down to what is held), and
 * more than 0 when publishing.
 */
export function checkQuantity(
  quantity: number,
  unitCode: UnitCode,
  options: { held: number; publishing: boolean },
): QuantityCheck {
  if (!isQuantityOnStep(quantity, unitCode)) return { ok: false, reason: 'step' };
  if (options.publishing && quantity <= 0) return { ok: false, reason: 'zero' };
  if (quantity < options.held) return { ok: false, reason: 'below_held' };
  return { ok: true, reason: null };
}
