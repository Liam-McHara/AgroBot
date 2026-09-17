import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CATALOG_SOURCES,
  CATALOG_SYNC_STATUSES,
  CATALOG_SYNC_TRIGGERS,
  CURRENCY,
  PRODUCT_SOURCES,
  PRODUCT_STATUSES,
  UNIT_CODES,
  type CatalogSource,
  type CatalogIssue,
  type CatalogSyncStatus,
  type CatalogSyncTrigger,
  type ProductSource,
  type ProductStatus,
  type UnitCode,
} from '@agrobot/shared';
import { members } from './members.js';
import { inList } from './sql.js';

/** ARCH §5 `units`. Seeded from `UNITS` in `@agrobot/shared` — never edited by hand. */
export const units = pgTable(
  'units',
  {
    code: text('code').$type<UnitCode>().primaryKey(),
    nameCa: text('name_ca').notNull(),
    nameEs: text('name_es').notNull(),
    allowsDecimals: boolean('allows_decimals').notNull(),
    step: numeric('step', { precision: 10, scale: 2 }).notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [check('units_code_check', inList(table.code, UNIT_CODES))],
);

/** ARCH §5 `products`. `slug` is the normalized name the sheet is matched on (ARCH §10). */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    nameEs: text('name_es'),
    unitCode: text('unit_code')
      .$type<UnitCode>()
      .notNull()
      .references(() => units.code, { onDelete: 'restrict' }),
    priceCents: integer('price_cents'),
    currency: text('currency').notNull().default(CURRENCY),
    category: text('category'),
    status: text('status').$type<ProductStatus>().notNull().default('active'),
    source: text('source').$type<ProductSource>().notNull().default('sheet'),
    proposedBy: uuid('proposed_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('products_slug_key').on(table.slug),
    index('products_status_idx').on(table.status),
    check('products_status_check', inList(table.status, PRODUCT_STATUSES)),
    check('products_source_check', inList(table.source, PRODUCT_SOURCES)),
    // PRD §6: a pending product has no price; prices are never negative.
    check('products_price_check', sql`${table.priceCents} is null or ${table.priceCents} >= 0`),
  ],
);

/** ARCH §5 `catalog_syncs`: one row per run, shown to admins (PRD §10). */
export const catalogSyncs = pgTable(
  'catalog_syncs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    trigger: text('trigger').$type<CatalogSyncTrigger>().notNull(),
    status: text('status').$type<CatalogSyncStatus>().notNull(),
    source: text('source').$type<CatalogSource>().notNull(),
    contentHash: text('content_hash'),
    rowsRead: integer('rows_read').notNull().default(0),
    created: integer('created').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    archived: integer('archived').notNull().default(0),
    resolvedPending: integer('resolved_pending').notNull().default(0),
    errors: jsonb('errors').$type<CatalogIssue[]>().notNull().default([]),
    triggeredBy: uuid('triggered_by').references(() => members.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('catalog_syncs_started_at_idx').on(table.startedAt),
    check('catalog_syncs_status_check', inList(table.status, CATALOG_SYNC_STATUSES)),
    check('catalog_syncs_trigger_check', inList(table.trigger, CATALOG_SYNC_TRIGGERS)),
    check('catalog_syncs_source_check', inList(table.source, CATALOG_SOURCES)),
  ],
);

export type Unit = typeof units.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type CatalogSync = typeof catalogSyncs.$inferSelect;
