import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CURRENCY,
  REASON_MAX_LENGTH,
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '@agrobot/shared';
import { members } from './members.js';
import { offers } from './offers.js';
import { inList } from './sql.js';

/**
 * ARCH §5 `reservations`.
 *
 * `producer_id` is denormalized from the offer so "my incoming reservations" is one index
 * lookup, and so a reservation still names both parties after the offer changes hands in
 * ways we have not invented yet. `unit_price_cents` is the snapshot of PRD principle 5.
 */
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'restrict' }),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    producerId: uuid('producer_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
    unitPriceCents: integer('unit_price_cents'),
    currency: text('currency').notNull().default(CURRENCY),
    status: text('status').$type<ReservationStatus>().notNull().default('pending'),
    reason: text('reason'),
    closedBy: uuid('closed_by').references(() => members.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('reservations_offer_status_idx').on(table.offerId, table.status),
    index('reservations_requester_status_idx').on(table.requesterId, table.status),
    index('reservations_producer_status_idx').on(table.producerId, table.status),
    index('reservations_status_expires_at_idx').on(table.status, table.expiresAt),
    check('reservations_status_check', inList(table.status, RESERVATION_STATUSES)),
    check('reservations_quantity_check', sql`${table.quantity} > 0`),
    check(
      'reservations_price_check',
      sql`${table.unitPriceCents} is null or ${table.unitPriceCents} >= 0`,
    ),
    // PRD US-4.1: you cannot reserve your own offer.
    check('reservations_parties_differ', sql`${table.requesterId} <> ${table.producerId}`),
    check(
      'reservations_reason_length_check',
      sql`${table.reason} is null or length(${table.reason}) <= ${sql.raw(String(REASON_MAX_LENGTH))}`,
    ),
  ],
);

export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
