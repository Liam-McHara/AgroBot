import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { NOTE_MAX_LENGTH, OFFER_STATUSES, type OfferStatus } from '@agrobot/shared';
import { members } from './members.js';
import { products } from './catalog.js';
import { inList } from './sql.js';

/**
 * ARCH §5 `offers`.
 *
 * `available` and `held` are never stored: they are derived from the reservations that hold
 * quantity, inside the transaction that needs them (ARCH §5 "Derived, never stored").
 */
export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    producerId: uuid('producer_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
    note: text('note'),
    availableUntil: date('available_until'),
    status: text('status').$type<OfferStatus>().notNull().default('active'),
    stale: boolean('stale').notNull().default(false),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    nudgedAt: timestamp('nudged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // PRD US-3.1: one *active* offer per (producer, product). Withdrawn and expired ones stay.
    uniqueIndex('offers_one_active_per_producer_product')
      .on(table.producerId, table.productId)
      .where(sql`${table.status} = 'active'`),
    index('offers_status_available_until_idx').on(table.status, table.availableUntil),
    index('offers_producer_idx').on(table.producerId, table.status),
    check('offers_status_check', inList(table.status, OFFER_STATUSES)),
    check('offers_quantity_check', sql`${table.quantity} >= 0`),
    check(
      'offers_note_length_check',
      sql`${table.note} is null or length(${table.note}) <= ${sql.raw(String(NOTE_MAX_LENGTH))}`,
    ),
  ],
);

export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;
