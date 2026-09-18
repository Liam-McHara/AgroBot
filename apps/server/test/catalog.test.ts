import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  products,
  catalogSyncs,
  members,
  notifications,
  offers,
  type Member,
} from '../src/db/schema/index.js';
import { createCatalogService } from '../src/domain/catalog/service.js';
import { catalogLifecycle } from '../src/domain/catalog/lifecycle.js';
import { createCsvCatalogSource } from '../src/integrations/csv-catalog.js';
import { createApp } from '../src/http/app.js';
import { jobs } from '../src/jobs/index.js';
import { adminCatalogSchema, productsResponseSchema } from '@agrobot/shared';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;
const header = ['Product', 'Unit', 'Price'];
let cells: unknown[][];
let admin: Member;
let farmer: Member;
let other: Member;
const fetchRows = vi.fn(async () => cells);
const source = { kind: 'csv' as const, sheetUrl: 'https://example.test/catalog.csv', fetchRows };
const service = () => createCatalogService({ db: database!.db, source });
const sync = () => service().sync({ trigger: 'manual', actor: admin });
const rows = () => database!.db.select().from(products).orderBy(products.slug);
const notices = (kind: 'N4' | 'N5' | 'N12') =>
  database!.db.select().from(notifications).where(eq(notifications.kind, kind));

suite('catalogue: real Postgres (US-2.1, US-2.2)', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
    const [a] = await database!.db
      .insert(members)
      .values({ telegramId: 7000, displayName: 'Admin', role: 'admin', status: 'approved' })
      .returning();
    admin = a!;
    [farmer, other] = (await database!.db
      .select()
      .from(members)
      .where(eq(members.role, 'member'))
      .orderBy(members.telegramId)) as [Member, Member];
    cells = [header, ['Tomàquet', 'kg', '2,35'], ['Ous', 'dozen', '3.10']];
    fetchRows.mockClear();
  });
  afterAll(async () => {
    await database?.close();
  });

  it('imports, updates prices, archives missing rows, and unarchives without changing ids', async () => {
    expect(await sync()).toMatchObject({ status: 'ok', rowsRead: 2, created: 2, updated: 0 });
    const original = (await rows()).find((p) => p.slug === 'tomaquet')!;
    cells = [header, ['Ous', 'dozen', 4]];
    expect(await sync()).toMatchObject({ updated: 1, archived: 1 });
    expect(await service().list(farmer)).toHaveLength(1);
    cells.push(['Tomàquet', 'kg', 2.5]);
    expect(await sync()).toMatchObject({ updated: 1, created: 0 });
    expect((await rows()).find((p) => p.slug === 'tomaquet')).toMatchObject({
      id: original.id,
      status: 'active',
      priceCents: 250,
    });
  });
  it('applies valid rows, preserves invalid named rows and reports their sheet row number', async () => {
    await sync();
    cells = [header, [], ['Tomàquet', 'sac', 5], ['Enciam', 'unit', 1]];
    const result = await sync();
    expect(result).toMatchObject({
      status: 'partial',
      created: 1,
      archived: 1,
      errors: [{ row: 3, reason: 'unit', severity: 'error' }],
    });
    expect((await rows()).find((p) => p.slug === 'tomaquet')).toMatchObject({
      status: 'active',
      priceCents: 235,
    });
    const before = await rows();
    expect(await sync()).toMatchObject({
      status: 'partial',
      created: 0,
      updated: 0,
      archived: 0,
      errors: result.errors,
    });
    expect(await rows()).toEqual(before);
  });
  it('short-circuits unchanged valid content and still logs each attempt', async () => {
    await sync();
    const before = await rows();
    expect(await sync()).toMatchObject({ status: 'ok', created: 0, updated: 0, archived: 0 });
    expect(await rows()).toEqual(before);
    expect(await database!.db.select().from(catalogSyncs)).toHaveLength(2);
  });
  it('rejects empty input and source errors without changing products; N12 only reaches approved admins', async () => {
    await database!.db.insert(members).values({
      telegramId: 7010,
      displayName: 'Suspended admin',
      role: 'admin',
      status: 'suspended',
    });
    await sync();
    const before = await rows();
    cells = [header];
    expect(await sync()).toMatchObject({
      status: 'failed',
      errors: [{ row: 0, reason: 'empty', severity: 'error' }],
    });
    expect(await sync()).toMatchObject({ status: 'failed' });
    fetchRows.mockRejectedValueOnce(new Error('SECRET from source'));
    expect(await sync()).toMatchObject({
      status: 'failed',
      errors: [{ row: 0, reason: 'unreachable', severity: 'error' }],
    });
    expect(await rows()).toEqual(before);
    expect((await notices('N12')).map((n) => n.memberId)).toEqual([admin.id, admin.id, admin.id]);
    expect(JSON.stringify(await database!.db.select().from(catalogSyncs))).not.toContain('SECRET');
  });
  it('proposes idempotently, isolates pending search results, and resolves through a real CSV source', async () => {
    let csv = 'Producte,Unitat,Preu\nOus,dotzena,3\n';
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/csv');
      response.end(csv);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing fixture server port');
      const catalog = createCatalogService({
        db: database!.db,
        source: createCsvCatalogSource(`http://127.0.0.1:${address.port}`),
      });
      const proposal = await catalog.propose(farmer, {
        name: 'tomàquet cor de bou',
        unitCode: 'kg',
      });
      const repeats = await Promise.all(
        Array.from({ length: 3 }, () =>
          catalog.propose(farmer, { name: ' TOMAQUET COR DE BOU ', unitCode: 'kg' }),
        ),
      );
      expect(repeats.every((p) => p.id === proposal.id)).toBe(true);
      expect(await notices('N4')).toHaveLength(1);
      expect((await notices('N4'))[0]?.payload).toMatchObject({ name: 'tomàquet cor de bou' });
      expect(await catalog.list(farmer, 'TOMAQUET')).toHaveLength(1);
      expect(await catalog.list(other)).toHaveLength(0);
      expect(await catalog.list(farmer, '', false)).toHaveLength(0);
      await expect(
        catalog.propose(other, { name: 'tomàquet cor de bou', unitCode: 'kg' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await catalog.sync({ trigger: 'schedule' });
      expect((await rows()).find((p) => p.id === proposal.id)?.status).toBe('pending');
      csv += 'Tomàquet cor de bou,kg,"2,40"\n';
      expect(await catalog.sync({ trigger: 'manual', actor: admin })).toMatchObject({
        resolvedPending: 1,
      });
      expect((await rows()).find((p) => p.id === proposal.id)).toMatchObject({
        status: 'active',
        priceCents: 240,
        source: 'sheet',
      });
      expect(await notices('N5')).toHaveLength(1);
      await catalog.sync({ trigger: 'schedule' });
      expect(await notices('N5')).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it('reads the mixed CSV fixture through the adapter and reports the unknown unit', async () => {
    const csv = await readFile(new URL('fixtures/catalog.csv', import.meta.url), 'utf8');
    const catalog = createCatalogService({
      db: database!.db,
      source: createCsvCatalogSource(
        source.sheetUrl,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(csv)),
      ),
    });
    expect(await catalog.sync({ trigger: 'schedule' })).toMatchObject({
      status: 'partial',
      created: 3,
      errors: [{ row: 4, reason: 'unit', severity: 'error' }],
    });
  });
  it('renames pending products, resolves existing active matches, and rejects name collisions', async () => {
    await sync();
    const proposal = await service().propose(farmer, { name: 'Tomaket', unitCode: 'kg' });
    expect(await service().rename(admin, proposal.id, 'Tomàquet nou')).toMatchObject({
      id: proposal.id,
      status: 'pending',
    });
    const resolved = await service().rename(admin, proposal.id, 'TOMAQUET');
    expect(resolved).toMatchObject({ status: 'active', priceCents: 235 });
    expect(await rows()).toHaveLength(3);
    expect((await rows()).find((p) => p.id === proposal.id)?.status).toBe('archived');
    expect(await notices('N5')).toHaveLength(1);
    await expect(service().rename(admin, resolved.id, 'Another name')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    const one = await service().propose(farmer, { name: 'Un producte', unitCode: 'kg' });
    const two = await service().propose(other, { name: 'Altre producte', unitCode: 'kg' });
    await expect(service().rename(admin, one.id, two.name)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('does not let a matching hash bypass a pending product', async () => {
    await sync();
    const product = (await rows())[0]!;
    await database!.db
      .update(products)
      .set({ status: 'pending', source: 'member', proposedBy: farmer.id, priceCents: null })
      .where(eq(products.id, product.id));
    expect(await sync()).toMatchObject({ resolvedPending: 1, updated: 1 });
    expect(await notices('N5')).toHaveLength(1);
  });
  it('rejects pending products transactionally and notifies their proposer', async () => {
    const product = await service().propose(farmer, { name: 'Proposta', unitCode: 'unit' });
    await service().reject(admin, product.id);
    expect(await rows()).toHaveLength(0);
    expect((await notices('N5'))[0]).toMatchObject({
      memberId: farmer.id,
      payload: { decision: 'rejected', name: 'Proposta' },
    });
    await expect(service().reject(admin, product.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('keeps referenced proposals safe until M3 supplies the rejection/merge cascade', async () => {
    const pending = await service().propose(farmer, { name: 'Pending product', unitCode: 'kg' });
    await database!.db
      .insert(offers)
      .values({ producerId: farmer.id, productId: pending.id, quantity: '2' });
    await expect(service().reject(admin, pending.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await notices('N5')).toHaveLength(0);
    expect((await rows())[0]?.status).toBe('pending');
  });
  it('warns when changing units on active offers', async () => {
    await sync();
    const product = (await rows()).find((p) => p.slug === 'tomaquet')!;
    await database!.db
      .insert(offers)
      .values({ producerId: farmer.id, productId: product.id, quantity: '3' });
    cells = [header, ['Tomàquet', 'box', 4], ['Ous', 'dozen', 3.1]];
    expect(await sync()).toMatchObject({
      status: 'partial',
      errors: [{ row: 2, reason: 'unit_changed', severity: 'warning' }],
    });
    expect(await sync()).toMatchObject({
      status: 'partial',
      updated: 0,
      errors: [{ row: 2, reason: 'unit_changed', severity: 'warning' }],
    });
  });
  it('rolls back the entire diff and outbox if a lifecycle hook fails', async () => {
    const product = await service().propose(farmer, { name: 'Tomàquet', unitCode: 'kg' });
    const catalog = createCatalogService({
      db: database!.db,
      source,
      lifecycle: {
        ...catalogLifecycle,
        resolvePrice: async () => {
          throw new Error('test rollback');
        },
      },
    });
    await expect(catalog.sync({ trigger: 'schedule' })).rejects.toThrow('test rollback');
    expect(await rows()).toMatchObject([{ id: product.id, status: 'pending', priceCents: null }]);
    expect(await notices('N5')).toHaveLength(0);
    expect(await database!.db.select().from(catalogSyncs)).toHaveLength(0);
  });
  it('uses the fresh actor row for every domain action', async () => {
    const proposal = await service().propose(farmer, { name: 'Proposta', unitCode: 'kg' });
    await database!.db.update(members).set({ role: 'member' }).where(eq(members.id, admin.id));
    for (const run of [
      () => sync(),
      () => service().rename(admin, proposal.id, 'Nou nom'),
      () => service().reject(admin, proposal.id),
      () => service().adminCatalog(admin),
      () => service().status(admin),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(fetchRows).not.toHaveBeenCalled();
    await database!.db
      .update(members)
      .set({ status: 'suspended' })
      .where(eq(members.id, farmer.id));
    await expect(service().list(farmer)).rejects.toMatchObject({ code: 'SUSPENDED' });
    await expect(
      service().propose(farmer, { name: 'New proposal', unitCode: 'kg' }),
    ).rejects.toMatchObject({ code: 'SUSPENDED' });
  });
  it('serializes concurrent manual and scheduled fetches so an older result cannot win', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => {
        started();
        await gate;
        return [header, ['Tomàquet', 'kg', 1]];
      })
      .mockResolvedValue([header, ['Tomàquet', 'kg', 2]]);
    const catalog = createCatalogService({
      db: database!.db,
      source: { ...source, fetchRows: fetcher },
    });
    const first = catalog.sync({ trigger: 'schedule' });
    await entered;
    const second = catalog.sync({ trigger: 'manual', actor: admin });
    release();
    await Promise.all([first, second]);
    expect((await rows())[0]?.priceCents).toBe(200);
  });
  it('runs as the hub job: scheduled runs, manual runs with the actor, next due at minute 7', async () => {
    const deps = testDeps(database!, {}, { source });
    const jobDeps = { ...deps.jobDeps, now: () => new Date('2026-07-01T10:30:00Z') };
    const scheduled = await jobs['catalog.sync'].run(jobDeps, undefined);
    expect(scheduled.result).toMatchObject({ trigger: 'schedule', status: 'ok', created: 2 });
    expect(scheduled.nextDueAt?.toISOString()).toBe('2026-07-01T11:07:00.000Z');
    const manual = await jobs['catalog.sync'].run(jobDeps, {
      trigger: 'manual',
      actorId: admin.id,
    });
    expect(manual.result).toMatchObject({ trigger: 'manual', triggeredBy: admin.id });
    // The actor is re-read and re-authorized by the domain, not trusted from the caller.
    await expect(
      jobs['catalog.sync'].run(jobDeps, { trigger: 'manual', actorId: farmer.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      jobs['catalog.sync'].run(jobDeps, {
        trigger: 'command',
        actorId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(await database!.db.select().from(catalogSyncs)).toMatchObject([
      { trigger: 'schedule' },
      { trigger: 'manual' },
    ]);
  });
  it('wakes the hub after commits that enqueue notifications (ARCH §8 step 2)', async () => {
    const deps = testDeps(database!, {}, { source });
    await deps.catalog.sync({ trigger: 'schedule' });
    expect(deps.hub.wakes).toBe(0);
    await deps.catalog.propose(farmer, { name: 'Proposta', unitCode: 'kg' });
    expect(deps.hub.wakes).toBe(1);
    cells = [header];
    await deps.catalog.sync({ trigger: 'schedule' });
    expect(deps.hub.wakes).toBe(2);
    cells = [header, ['Tomàquet', 'kg', '2,35'], ['Ous', 'dozen', '3.10'], ['Proposta', 'kg', 1]];
    expect(await deps.catalog.sync({ trigger: 'schedule' })).toMatchObject({ resolvedPending: 1 });
    expect(deps.hub.wakes).toBe(3);
  });

  it('serves typed routes, validates input and keeps applicants/non-admins out', async () => {
    const deps = testDeps(database!, { DEV_AUTH_BYPASS_TELEGRAM_ID: '900000001' }, { source });
    const app = createApp(deps);
    const request = (path: string, telegramId = 900000001, body?: unknown) =>
      app.request(`/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `dev ${telegramId}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect((await request('/products', 7999)).status).toBe(403);
    expect((await request('/admin/catalog')).status).toBe(403);
    expect((await request('/admin/catalog/sync', 900000001, {})).status).toBe(403);
    expect(
      (await request('/products/proposals', 900000001, { name: 'X', unitCode: 'bad' })).status,
    ).toBe(400);
    expect((await request('/products?includePending=wrong')).status).toBe(400);
    const proposalResponse = await request('/products/proposals', 900000001, {
      name: 'Proposta',
      unitCode: 'kg',
    });
    expect(proposalResponse.status).toBe(201);
    const proposal = (await proposalResponse.json()) as { product: { id: string } };
    const listing = productsResponseSchema.parse(
      await (await request('/products?q=proposta')).json(),
    );
    expect(listing.products).toHaveLength(1);
    expect(listing.products[0]).not.toHaveProperty('proposedBy');
    expect(
      (await request('/admin/products/not-a-uuid/rename', 7000, { name: 'Nou nom' })).status,
    ).toBe(400);
    expect(
      (
        await request(`/admin/products/${proposal.product.id}/rename`, 900000001, {
          name: 'Nou nom',
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(`/admin/products/${proposal.product.id}/rename`, 7000, { name: 'Nou nom' }))
        .status,
    ).toBe(200);
    expect((await request(`/admin/products/${proposal.product.id}/reject`, 7000, {})).status).toBe(
      204,
    );
    expect((await request('/admin/catalog/sync', 7000, {})).status).toBe(200);
    const adminResponse = adminCatalogSchema.parse(
      await (await request('/admin/catalog', 7000)).json(),
    );
    expect(adminResponse.counts).toEqual({ active: 2, archived: 0, pending: 0 });
    expect(adminResponse.syncs[0]?.status).toBe('ok');
    cells = [];
    const failure = await request('/admin/catalog/sync', 7000, {});
    expect(await failure.json()).toMatchObject({ sync: { status: 'failed' } });
  });
});
