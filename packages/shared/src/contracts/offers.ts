import { z } from 'zod';
import { NOTE_MAX_LENGTH, OFFER_STATUSES } from '../enums.js';
import { isoDateSchema } from '../dates.js';
import { QUANTITY_MAX } from '../quantity.js';
import { productSchema } from './catalog.js';

/**
 * PRD §7 (US-3.1–3.4) and ARCH §11 `/board`, `/offers`. The unit step of a quantity depends on
 * the product, which a body only names by id, so the schemas below bound quantities and the
 * domain checks the step (`isQuantityOnStep`) once it has the product.
 */
const quantitySchema = z.number().finite().min(0).max(QUANTITY_MAX);

/** PRD US-3.1: an optional note of at most 200 characters; blank means none. */
export const offerNoteSchema = z.string().trim().min(1).max(NOTE_MAX_LENGTH);

/** `POST /offers`: publish. `availableUntil` is a farm calendar date, today or later. */
export const publishOfferSchema = z.object({
  productId: z.uuid(),
  quantity: quantitySchema.positive(),
  availableUntil: isoDateSchema.nullable().optional(),
  note: offerNoteSchema.nullable().optional(),
});
export type PublishOffer = z.infer<typeof publishOfferSchema>;

/**
 * `PATCH /offers/:id` (US-3.2): any of the three, at least one. `null` removes the date or the
 * note. Quantity may go down to what is held, zero included, never below.
 */
export const editOfferSchema = z
  .object({
    quantity: quantitySchema.optional(),
    availableUntil: isoDateSchema.nullable().optional(),
    note: offerNoteSchema.nullable().optional(),
  })
  .refine(
    (body) =>
      body.quantity !== undefined || body.availableUntil !== undefined || body.note !== undefined,
    { message: 'nothing to update' },
  );
export type EditOffer = z.infer<typeof editOfferSchema>;

export const offerProducerSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
});

/**
 * An offer as any member sees it (PRD US-3.3): the product, who offers it, what is still
 * available, until when, the note and the stale marker. Totals are the producer's business.
 */
export const offerSchema = z.object({
  id: z.uuid(),
  product: productSchema,
  producer: offerProducerSchema,
  /** ARCH §5: `quantity − held`, derived in the query, never stored. */
  available: z.number(),
  availableUntil: isoDateSchema.nullable(),
  note: z.string().nullable(),
  status: z.enum(OFFER_STATUSES),
  stale: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OfferView = z.infer<typeof offerSchema>;

/** The producer's own view (`GET /offers/mine`, mutations): totals and the nudge state too. */
export const myOfferSchema = offerSchema.extend({
  quantity: z.number(),
  held: z.number(),
  /** Pending and confirmed reservations on it; what US-3.2 reminds about on withdrawal. */
  openReservations: z.number().int().nonnegative(),
  lastActivityAt: z.iso.datetime(),
  nudgedAt: z.iso.datetime().nullable(),
});
export type MyOfferView = z.infer<typeof myOfferSchema>;

/** `GET /offers/:id`: the producer gets their totals; everyone else gets `null` there. */
export const offerDetailSchema = offerSchema.extend({
  quantity: z.number().nullable(),
  held: z.number().nullable(),
  openReservations: z.number().int().nonnegative().nullable(),
  nudgedAt: z.iso.datetime().nullable(),
});
export type OfferDetailView = z.infer<typeof offerDetailSchema>;

export const myOffersResponseSchema = z.object({ offers: z.array(myOfferSchema) });
export type MyOffersResponse = z.infer<typeof myOffersResponseSchema>;
export const myOfferResponseSchema = z.object({ offer: myOfferSchema });
export type MyOfferResponse = z.infer<typeof myOfferResponseSchema>;
export const offerDetailResponseSchema = z.object({ offer: offerDetailSchema });
export type OfferDetailResponse = z.infer<typeof offerDetailResponseSchema>;

/** ARCH §11 `409 OFFER_ALREADY_ACTIVE`: the existing offer to open for editing (US-3.1). */
export const offerAlreadyActiveDetailsSchema = z.object({ offerId: z.uuid() });

// ---------------------------------------------------------------------------
// Board (PRD US-3.3, ARCH §11 `GET /board`)
// ---------------------------------------------------------------------------

export const BOARD_GROUPINGS = ['product', 'producer'] as const;
export type BoardGrouping = (typeof BOARD_GROUPINGS)[number];

export const boardQuerySchema = z.object({
  group: z.enum(BOARD_GROUPINGS).default('product'),
  q: z.string().trim().max(100).default(''),
  category: z.string().trim().max(40).default(''),
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

/** One group of the board: a product (with its Spanish name) or a producer. */
export const boardGroupSchema = z.object({
  key: z.uuid(),
  name: z.string(),
  nameEs: z.string().nullable(),
  offers: z.array(offerSchema),
});
export type BoardGroup = z.infer<typeof boardGroupSchema>;

export const boardSchema = z.object({
  group: z.enum(BOARD_GROUPINGS),
  groups: z.array(boardGroupSchema),
  /** Every category among the member's reservable offers, for the filter chips. */
  categories: z.array(z.string()),
  /** Offers shown after search and category filter. */
  total: z.number().int().nonnegative(),
});
export type BoardView = z.infer<typeof boardSchema>;
