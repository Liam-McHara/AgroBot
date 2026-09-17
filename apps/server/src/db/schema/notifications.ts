import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_STATUSES,
  type NotificationKind,
  type NotificationStatus,
} from '@agrobot/shared';
import { members } from './members.js';
import { inList } from './sql.js';

/**
 * ARCH §5 / §8 `notifications`: the transactional outbox (ADR-0009).
 *
 * Domain code inserts rows here inside the transaction that changed the state; the dispatcher
 * job is the only thing that talks to the Telegram API. `dedupe_key` is what makes the chat
 * notification throttle of PRD US-5.1 a database constraint rather than a race.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<NotificationKind>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text('dedupe_key'),
    status: text('status').$type<NotificationStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    index('notifications_status_next_attempt_at_idx').on(table.status, table.nextAttemptAt),
    index('notifications_member_idx').on(table.memberId, table.createdAt),
    uniqueIndex('notifications_dedupe_key_key')
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    check('notifications_kind_check', inList(table.kind, NOTIFICATION_KINDS)),
    check('notifications_status_check', inList(table.status, NOTIFICATION_STATUSES)),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
