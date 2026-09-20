import { z } from 'zod';
import {
  OFFER_STATUSES,
  REASON_MAX_LENGTH,
  RESERVATION_ACTIONS,
  RESERVATION_SIDES,
  RESERVATION_STATES,
  RESERVATION_STATUSES,
} from '../enums.js';
import { isoDateSchema } from '../dates.js';
import { QUANTITY_MAX } from '../quantity.js';
import { productSchema } from './catalog.js';
import { threadStateSchema } from './threads.js';

/**
 * PRD §8 (US-4.1–4.6) and ARCH §11 `/reservations`. As with offers, a body names the offer by
 * id and the unit step depends on its product, so the schema bounds the quantity and the domain
 * checks the step and the availability inside the locking transaction (PRD principle 2).
 */

/** `POST /reservations` (US-4.1). */
export const createReservationSchema = z.object({
  offerId: z.uuid(),
  quantity: z.number().finite().positive().max(QUANTITY_MAX),
});
export type CreateReservation = z.infer<typeof createReservationSchema>;

/** PRD US-4.2, US-4.3: an optional reason of at most 200 characters; blank means none. */
export const reservationReasonSchema = z.string().trim().min(1).max(REASON_MAX_LENGTH);

/** Body of `/reject` and `/cancel`; `/confirm`, `/deliver` and `/confirm-and-deliver` take none. */
export const reservationActionBodySchema = z.object({
  reason: reservationReasonSchema.nullable().optional(),
});
export type ReservationActionBody = z.infer<typeof reservationActionBodySchema>;

/** `GET /reservations?side=&state=` (US-4.6). */
export const reservationsQuerySchema = z.object({
  side: z.enum(RESERVATION_SIDES),
  state: z.enum(RESERVATION_STATES).default('active'),
});
export type ReservationsQuery = z.infer<typeof reservationsQuerySchema>;

/** One of the two parties. The username feeds *Open in Telegram* (US-5.2). */
export const reservationPartySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  username: z.string().nullable(),
});
export type ReservationParty = z.infer<typeof reservationPartySchema>;

/**
 * A reservation as one of its parties sees it (US-4.6): the product, the quantity, the price
 * snapshot and total (or `null` while the price is pending), both parties and which side the
 * viewer is on, the status with its timestamps, and the actions the viewer may take right now
 * (ARCH §6), so a screen never guesses at the state machine.
 */
export const reservationSchema = z.object({
  id: z.uuid(),
  offerId: z.uuid(),
  product: productSchema,
  quantity: z.number(),
  /** PRD principle 5: snapshotted when reserving; `null` until a pending product is resolved. */
  unitPriceCents: z.number().int().nonnegative().nullable(),
  currency: z.literal('EUR'),
  totalCents: z.number().int().nonnegative().nullable(),
  status: z.enum(RESERVATION_STATUSES),
  /** `incoming` when the viewer is the producer, `outgoing` when they are the requester. */
  side: z.enum(RESERVATION_SIDES),
  requester: reservationPartySchema,
  producer: reservationPartySchema,
  counterpart: reservationPartySchema,
  reason: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  actions: z.array(z.enum(RESERVATION_ACTIONS)),
  /** PRD US-4.6: the viewer's unread text messages in this thread (US-5.1). */
  unread: z.number().int().nonnegative(),
});
export type ReservationView = z.infer<typeof reservationSchema>;

/** What the detail shows of the offer behind the reservation. */
export const reservationOfferSchema = z.object({
  id: z.uuid(),
  status: z.enum(OFFER_STATUSES),
  note: z.string().nullable(),
  availableUntil: isoDateSchema.nullable(),
  /** ARCH §5: what is left on the offer right now, for "reserve more" decisions. */
  available: z.number(),
});

/** `GET /reservations/:id` and every mutation: the reservation, its offer and its thread's state. */
export const reservationDetailSchema = reservationSchema.extend({
  offer: reservationOfferSchema,
  /** PRD US-5.1: whether the viewer may still write, and until when once closed. */
  thread: threadStateSchema,
});
export type ReservationDetailView = z.infer<typeof reservationDetailSchema>;

export const reservationsResponseSchema = z.object({ reservations: z.array(reservationSchema) });
export type ReservationsResponse = z.infer<typeof reservationsResponseSchema>;
export const reservationResponseSchema = z.object({ reservation: reservationDetailSchema });
export type ReservationResponse = z.infer<typeof reservationResponseSchema>;

/** ARCH §11 `409 INSUFFICIENT_AVAILABILITY {available}`: what the UI offers to reserve instead. */
export const insufficientAvailabilityDetailsSchema = z.object({ available: z.number() });
export type InsufficientAvailabilityDetails = z.infer<typeof insufficientAvailabilityDetailsSchema>;
