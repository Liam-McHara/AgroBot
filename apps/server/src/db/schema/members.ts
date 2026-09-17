import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  type Language,
  type MemberRole,
  type MemberStatus,
} from '@agrobot/shared';
import { inList } from './sql.js';

/** ARCH §5 `members`. Identity comes from Telegram (ADR-0010); there are no passwords. */
export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
    username: text('username'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    displayName: text('display_name').notNull(),
    language: text('language').$type<Language>().notNull().default(DEFAULT_LANGUAGE),
    role: text('role').$type<MemberRole>().notNull().default('member'),
    status: text('status').$type<MemberStatus>().notNull().default('pending'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references((): AnyPgColumn => members.id, {
      onDelete: 'set null',
    }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('members_telegram_id_key').on(table.telegramId),
    index('members_status_idx').on(table.status),
    check('members_language_check', inList(table.language, LANGUAGES)),
    check('members_role_check', inList(table.role, MEMBER_ROLES)),
    check('members_status_check', inList(table.status, MEMBER_STATUSES)),
  ],
);

/** ARCH §5 `member_invites`: PRD US-1.3 pre-approval by `@username` or Telegram id. */
export const memberInvites = pgTable(
  'member_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramId: bigint('telegram_id', { mode: 'number' }),
    username: text('username'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    usedBy: uuid('used_by').references(() => members.id, { onDelete: 'set null' }),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('member_invites_telegram_id_key')
      .on(table.telegramId)
      .where(sql`${table.telegramId} is not null`),
    uniqueIndex('member_invites_username_key')
      .on(table.username)
      .where(sql`${table.username} is not null`),
    // An invite that identifies nobody would silently never match.
    check(
      'member_invites_identifies_someone',
      sql`${table.telegramId} is not null or ${table.username} is not null`,
    ),
  ],
);

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type MemberInvite = typeof memberInvites.$inferSelect;
