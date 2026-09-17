import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { MESSAGE_KINDS, MESSAGE_MAX_LENGTH, type MessageKind } from '@agrobot/shared';
import { members } from './members.js';
import { reservations } from './reservations.js';
import { inList } from './sql.js';

/**
 * ARCH §5 `messages`: the thread attached to one reservation (ADR-0005).
 *
 * `sender_id` is null for the system lines written on every transition ("Marta confirmed the
 * reservation"), whose wording is rendered from `meta` in the reader's language.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => members.id, { onDelete: 'set null' }),
    kind: text('kind').$type<MessageKind>().notNull().default('text'),
    body: text('body').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('messages_reservation_created_at_idx').on(table.reservationId, table.createdAt),
    check('messages_kind_check', inList(table.kind, MESSAGE_KINDS)),
    check(
      'messages_body_length_check',
      sql`length(${table.body}) between 1 and ${sql.raw(String(MESSAGE_MAX_LENGTH))}`,
    ),
    // A text message always has an author; only system lines may have none.
    check('messages_sender_check', sql`${table.kind} = 'system' or ${table.senderId} is not null`),
  ],
);

/** ARCH §5 `thread_reads`: one row per (reservation, member), drives the unread badges. */
export const threadReads = pgTable(
  'thread_reads',
  {
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    lastReadMessageId: uuid('last_read_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.reservationId, table.memberId] })],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ThreadRead = typeof threadReads.$inferSelect;
