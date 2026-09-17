import { z } from 'zod';
import { CATALOG_SOURCES, CATALOG_SYNC_STATUSES, PRODUCT_STATUSES, UNIT_CODES } from '../enums.js';

export const normalizeProductName = (name: string): string =>
  name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');

export const productNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .refine((name) => normalizeProductName(name).length >= 2);
export const proposeProductSchema = z.object({
  name: productNameSchema,
  unitCode: z.enum(UNIT_CODES),
});
export const renameProductSchema = z.object({ name: productNameSchema });
export const productsQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  includePending: z.enum(['0', '1']).default('1'),
});
export const productSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  nameEs: z.string().nullable(),
  unitCode: z.enum(UNIT_CODES),
  priceCents: z.number().int().nonnegative().nullable(),
  currency: z.literal('EUR'),
  category: z.string().nullable(),
  status: z.enum(PRODUCT_STATUSES),
});
export const CATALOG_ISSUE_REASONS = [
  'headers',
  'name',
  'unit',
  'price',
  'category',
  'name_es',
  'duplicate',
  'empty',
  'unreachable',
  'unit_changed',
] as const;
export const catalogIssueSchema = z.object({
  row: z.number().int().nonnegative(),
  reason: z.enum(CATALOG_ISSUE_REASONS),
  severity: z.enum(['error', 'warning']).default('error'),
});
export const catalogSyncSchema = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  status: z.enum(CATALOG_SYNC_STATUSES),
  source: z.enum(CATALOG_SOURCES),
  rowsRead: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  archived: z.number().int(),
  resolvedPending: z.number().int(),
  errors: z.array(catalogIssueSchema),
});
export const productsResponseSchema = z.object({ products: z.array(productSchema) });
export const productResponseSchema = z.object({ product: productSchema });
export const syncResponseSchema = z.object({ sync: catalogSyncSchema });
export const adminCatalogSchema = z.object({
  products: z.array(productSchema),
  syncs: z.array(catalogSyncSchema),
  sheetUrl: z.url(),
  counts: z.object({ active: z.number(), archived: z.number(), pending: z.number() }),
});
export type ProductView = z.infer<typeof productSchema>;
export type ProposeProduct = z.infer<typeof proposeProductSchema>;
export type CatalogIssue = z.infer<typeof catalogIssueSchema>;
export type CatalogIssueReason = CatalogIssue['reason'];
export type CatalogSyncView = z.infer<typeof catalogSyncSchema>;
export type ProductsResponse = z.infer<typeof productsResponseSchema>;
export type ProductResponse = z.infer<typeof productResponseSchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;
export type AdminCatalog = z.infer<typeof adminCatalogSchema>;
