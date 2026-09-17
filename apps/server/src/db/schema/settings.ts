import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { SETTING_KEYS, type SettingKey } from '@agrobot/shared';
import { members } from './members.js';
import { inList } from './sql.js';

/**
 * ARCH §5 `settings`: the group-wide knobs of PRD §10, read at run time by jobs and domain
 * services so changing one does not need a restart.
 */
export const settings = pgTable(
  'settings',
  {
    key: text('key').$type<SettingKey>().primaryKey(),
    value: jsonb('value').$type<number | boolean | string>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => members.id, { onDelete: 'set null' }),
  },
  (table) => [check('settings_key_check', inList(table.key, SETTING_KEYS))],
);

export type Setting = typeof settings.$inferSelect;
