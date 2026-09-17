import { Hono } from 'hono';
import {
  adminCatalogSchema,
  productSchema,
  productsQuerySchema,
  proposeProductSchema,
  renameProductSchema,
  catalogSyncSchema,
} from '@agrobot/shared';
import { authenticate, requireAdmin, requireMember } from '../middleware/auth.js';
import { parseBody, parseQuery, parseUuidParam } from '../validate.js';
import type { AppContext, AppDeps } from '../context.js';
import type { CatalogSync } from '../../db/schema/index.js';

export const toCatalogSync = (sync: CatalogSync) =>
  catalogSyncSchema.parse({
    ...sync,
    startedAt: sync.startedAt.toISOString(),
    finishedAt: sync.finishedAt?.toISOString() ?? null,
  });

export function catalogRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();
  app.use('/products', authenticate(deps), requireMember);
  app.use('/products/*', authenticate(deps), requireMember);
  app.use('/admin/catalog', authenticate(deps), requireAdmin);
  app.use('/admin/catalog/*', authenticate(deps), requireAdmin);
  app.use('/admin/products/*', authenticate(deps), requireAdmin);
  app.get('/products', async (c) => {
    const query = parseQuery(c, productsQuerySchema);
    const products = await deps.catalog.list(
      c.get('member')!,
      query.q,
      query.includePending === '1',
    );
    return c.json({ products: products.map((p) => productSchema.parse(p)) });
  });
  app.post('/products/proposals', async (c) => {
    const product = await deps.catalog.propose(
      c.get('member')!,
      await parseBody(c, proposeProductSchema),
    );
    return c.json({ product: productSchema.parse(product) }, 201);
  });
  app.get('/admin/catalog', async (c) => {
    const result = await deps.catalog.adminCatalog(c.get('member')!);
    return c.json(adminCatalogSchema.parse({ ...result, syncs: result.syncs.map(toCatalogSync) }));
  });
  app.post('/admin/catalog/sync', async (c) => {
    const sync = await deps.catalog.sync({ trigger: 'manual', actor: c.get('member')! });
    // A failed source is still a completed attempt with a report for the admin to inspect.
    return c.json({ sync: toCatalogSync(sync) });
  });
  app.post('/admin/products/:id/rename', async (c) => {
    const { name } = await parseBody(c, renameProductSchema);
    const product = await deps.catalog.rename(c.get('member')!, parseUuidParam(c, 'id'), name);
    return c.json({ product: productSchema.parse(product) });
  });
  app.post('/admin/products/:id/reject', async (c) => {
    await deps.catalog.reject(c.get('member')!, parseUuidParam(c, 'id'));
    return c.body(null, 204);
  });
  return app;
}
