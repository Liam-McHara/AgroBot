import { createHash } from 'node:crypto';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import {
  normalizeProductName,
  proposeProductSchema,
  renameProductSchema,
  type CatalogIssue,
  type ProposeProduct,
} from '@agrobot/shared';
import type { Database, Transaction } from '../../db/client.js';
import {
  catalogSyncs,
  members,
  offers,
  products,
  reservations,
  type Member,
  type Product,
} from '../../db/schema/index.js';
import { conflict, invalidTransition, notFound, validationFailed } from '../../errors.js';
import { assertAdmin, assertMember } from '../members/service.js';
import { enqueueNotifications } from '../notifications/outbox.js';
import { catalogLifecycle, type CatalogLifecycle } from './lifecycle.js';
import { parseCatalog, type CatalogRow, type ParsedCatalog } from './parser.js';
import type { CatalogSource } from './source.js';

export interface CatalogDeps {
  db: Database;
  source: CatalogSource;
  now?: () => Date;
  lifecycle?: CatalogLifecycle;
}
export type CatalogService = ReturnType<typeof createCatalogService>;

export function createCatalogService(deps: CatalogDeps) {
  const now = deps.now ?? (() => new Date());
  const lifecycle = deps.lifecycle ?? catalogLifecycle;

  async function actorFrom(tx: Transaction, actor: Member, admin: boolean): Promise<Member> {
    const [fresh] = await tx.select().from(members).where(eq(members.id, actor.id)).for('share');
    if (!fresh) throw notFound();
    if (admin) assertAdmin(fresh);
    else assertMember(fresh);
    return fresh;
  }
  async function lock(tx: Transaction): Promise<void> {
    // Every catalogue mutation uses the same transaction-scoped lock, including its fetch.
    await tx.execute(sql`select pg_advisory_xact_lock(207002)`);
  }
  async function admins(tx: Transaction): Promise<string[]> {
    return (
      await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.role, 'admin'), eq(members.status, 'approved')))
    ).map((m) => m.id);
  }
  async function notifyResolution(tx: Transaction, original: Product, resolved: Product, at: Date) {
    const requesters = await lifecycle.resolvePrice(tx, resolved, at);
    const recipients = [
      ...new Set([...(original.proposedBy ? [original.proposedBy] : []), ...requesters]),
    ];
    await enqueueNotifications(tx, recipients, 'N5', {
      productId: resolved.id,
      name: resolved.name,
      decision: 'resolved',
    });
  }
  const sameContent = (product: Product, row: CatalogRow) =>
    product.status === 'active' &&
    product.name === row.name &&
    product.nameEs === row.nameEs &&
    product.unitCode === row.unitCode &&
    product.priceCents === row.priceCents &&
    product.category === row.category;

  async function applyDiff(tx: Transaction, parsed: ParsedCatalog, hash: string, at: Date) {
    const all = await tx.select().from(products);
    const bySlug = new Map(all.map((p) => [p.slug, p]));
    const present = new Set(parsed.presentSlugs);
    const missing = all.filter(
      (p) => p.source === 'sheet' && p.status === 'active' && !present.has(p.slug),
    );
    const [previous] = await tx
      .select()
      .from(catalogSyncs)
      .where(sql`${catalogSyncs.status} <> 'failed'`)
      .orderBy(desc(catalogSyncs.startedAt))
      .limit(1);
    const stats = {
      created: 0,
      updated: 0,
      archived: 0,
      resolvedPending: 0,
      errors: [...parsed.errors],
    };
    if (
      previous?.contentHash === hash &&
      missing.length === 0 &&
      parsed.rows.every((r) => {
        const p = bySlug.get(r.slug);
        return p && sameContent(p, r);
      })
    ) {
      stats.errors.push(...previous.errors.filter((e) => e.severity === 'warning'));
      return stats;
    }
    for (const row of parsed.rows) {
      const existing = bySlug.get(row.slug);
      if (existing && sameContent(existing, row)) continue;
      if (existing && existing.unitCode !== row.unitCode) {
        const [activeOffer] = await tx
          .select({ id: offers.id })
          .from(offers)
          .where(and(eq(offers.productId, existing.id), eq(offers.status, 'active')))
          .limit(1);
        if (activeOffer)
          stats.errors.push({ row: row.row, reason: 'unit_changed', severity: 'warning' });
      }
      const values = {
        slug: row.slug,
        name: row.name,
        nameEs: row.nameEs,
        unitCode: row.unitCode,
        priceCents: row.priceCents,
        category: row.category,
        status: 'active' as const,
        source: 'sheet' as const,
        updatedAt: at,
      };
      if (!existing) {
        await tx.insert(products).values({ ...values, createdAt: at });
        stats.created++;
      } else {
        const [resolved] = await tx
          .update(products)
          .set(values)
          .where(eq(products.id, existing.id))
          .returning();
        stats.updated++;
        if (existing.status === 'pending') {
          stats.resolvedPending++;
          await notifyResolution(tx, existing, resolved!, at);
        }
      }
    }
    for (const product of missing) {
      await tx
        .update(products)
        .set({ status: 'archived', updatedAt: at })
        .where(eq(products.id, product.id));
      stats.archived++;
    }
    return stats;
  }

  /** US-2.1: source, diff, log and notifications are one serialized transaction. */
  async function sync(
    input: { trigger: 'schedule' } | { trigger: 'manual' | 'command'; actor: Member },
  ) {
    return deps.db.transaction(async (tx) => {
      await lock(tx);
      if ('actor' in input) await actorFrom(tx, input.actor, true);
      const startedAt = now();
      let cells: unknown[][];
      try {
        cells = await deps.source.fetchRows();
      } catch {
        return failed([{ row: 0, reason: 'unreachable', severity: 'error' }], 0, null);
      }
      const hash = createHash('sha256').update(JSON.stringify(cells)).digest('hex');
      const parsed = parseCatalog(cells);
      if (parsed.rows.length === 0) return failed(parsed.errors, parsed.rowsRead, hash);
      if ('actor' in input) await actorFrom(tx, input.actor, true);
      const stats = await applyDiff(tx, parsed, hash, now());
      const [report] = await tx
        .insert(catalogSyncs)
        .values({
          startedAt,
          finishedAt: now(),
          trigger: input.trigger,
          triggeredBy: 'actor' in input ? input.actor.id : null,
          source: deps.source.kind,
          contentHash: hash,
          rowsRead: parsed.rowsRead,
          status: stats.errors.length ? 'partial' : 'ok',
          ...stats,
        })
        .returning();
      return report!;

      async function failed(errors: CatalogIssue[], rowsRead: number, contentHash: string | null) {
        const [report] = await tx
          .insert(catalogSyncs)
          .values({
            startedAt,
            finishedAt: now(),
            trigger: input.trigger,
            triggeredBy: 'actor' in input ? input.actor.id : null,
            source: deps.source.kind,
            status: 'failed',
            rowsRead,
            errors,
            contentHash,
          })
          .returning();
        await enqueueNotifications(tx, await admins(tx), 'N12', { syncId: report!.id });
        return report!;
      }
    });
  }

  async function propose(actor: Member, input: ProposeProduct): Promise<Product> {
    const parsed = proposeProductSchema.safeParse(input);
    if (!parsed.success) throw validationFailed();
    return deps.db.transaction(async (tx) => {
      await lock(tx);
      await actorFrom(tx, actor, false);
      const slug = normalizeProductName(parsed.data.name);
      const [existing] = await tx.select().from(products).where(eq(products.slug, slug));
      if (existing) {
        if (existing.status === 'pending' && existing.proposedBy === actor.id) return existing;
        throw conflict({ reason: 'product_name_taken' });
      }
      const [product] = await tx
        .insert(products)
        .values({
          ...parsed.data,
          slug,
          status: 'pending',
          source: 'member',
          proposedBy: actor.id,
          priceCents: null,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      await enqueueNotifications(tx, await admins(tx), 'N4', {
        productId: product!.id,
        name: product!.name,
      });
      return product!;
    });
  }
  async function pending(tx: Transaction, id: string) {
    const [product] = await tx.select().from(products).where(eq(products.id, id)).for('update');
    if (!product) throw notFound();
    if (product.status !== 'pending') throw invalidTransition();
    return product;
  }
  async function rename(actor: Member, id: string, name: string) {
    const parsed = renameProductSchema.safeParse({ name });
    if (!parsed.success) throw validationFailed();
    return deps.db.transaction(async (tx) => {
      await lock(tx);
      await actorFrom(tx, actor, true);
      const original = await pending(tx, id);
      const slug = normalizeProductName(parsed.data.name);
      const [target] = await tx.select().from(products).where(eq(products.slug, slug));
      if (target && target.id !== id) {
        if (target.status !== 'active' || target.source !== 'sheet')
          throw conflict({ reason: 'product_name_taken' });
        await lifecycle.merge(tx, original, target, now());
        await notifyResolution(tx, original, target, now());
        await tx
          .update(products)
          .set({ status: 'archived', updatedAt: now() })
          .where(eq(products.id, id));
        return target;
      }
      const [updated] = await tx
        .update(products)
        .set({ name: parsed.data.name, slug, updatedAt: now() })
        .where(eq(products.id, id))
        .returning();
      return updated!;
    });
  }
  async function reject(actor: Member, id: string) {
    return deps.db.transaction(async (tx) => {
      await lock(tx);
      await actorFrom(tx, actor, true);
      const product = await pending(tx, id);
      const affected = await lifecycle.reject(tx, product, actor.id, now());
      const recipients = [
        ...new Set([...(product.proposedBy ? [product.proposedBy] : []), ...affected]),
      ];
      await enqueueNotifications(tx, recipients, 'N5', {
        productId: product.id,
        name: product.name,
        decision: 'rejected',
      });
      await tx.delete(products).where(eq(products.id, id));
    });
  }
  async function list(actor: Member, query = '', includePending = true) {
    return deps.db.transaction(async (tx) => {
      await actorFrom(tx, actor, false);
      const rows = await tx.select().from(products);
      const search = normalizeProductName(query);
      return rows
        .filter(
          (p) =>
            (p.status === 'active' ||
              (includePending && p.status === 'pending' && p.proposedBy === actor.id)) &&
            (p.slug.includes(search) || normalizeProductName(p.nameEs ?? '').includes(search)),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }
  async function adminCatalog(actor: Member) {
    return deps.db.transaction(async (tx) => {
      await actorFrom(tx, actor, true);
      const rows = await tx.select().from(products).orderBy(products.name);
      const syncs = await tx
        .select()
        .from(catalogSyncs)
        .orderBy(desc(catalogSyncs.startedAt))
        .limit(10);
      return {
        products: rows,
        syncs,
        sheetUrl: deps.source.sheetUrl,
        counts: {
          active: rows.filter((p) => p.status === 'active').length,
          archived: rows.filter((p) => p.status === 'archived').length,
          pending: rows.filter((p) => p.status === 'pending').length,
        },
      };
    });
  }
  async function hasSynced() {
    return (await deps.db.select({ id: catalogSyncs.id }).from(catalogSyncs).limit(1)).length > 0;
  }
  async function status(actor: Member) {
    return deps.db.transaction(async (tx) => {
      await actorFrom(tx, actor, true);
      const [memberCount] = await tx
        .select({ value: count() })
        .from(members)
        .where(eq(members.status, 'approved'));
      const [offerCount] = await tx
        .select({ value: count() })
        .from(offers)
        .where(eq(offers.status, 'active'));
      const [reservationCount] = await tx
        .select({ value: count() })
        .from(reservations)
        .where(eq(reservations.status, 'pending'));
      const [lastSync] = await tx
        .select()
        .from(catalogSyncs)
        .orderBy(desc(catalogSyncs.startedAt))
        .limit(1);
      return {
        members: memberCount!.value,
        offers: offerCount!.value,
        reservations: reservationCount!.value,
        lastSync: lastSync ?? null,
      };
    });
  }
  return { sync, propose, rename, reject, list, adminCatalog, hasSynced, status };
}
