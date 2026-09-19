import { and, eq, inArray } from 'drizzle-orm';
import type { Transaction } from '../../db/client.js';
import { offers, type Product } from '../../db/schema/index.js';
import { conflict } from '../../errors.js';

/**
 * What the catalogue does to the records that hang off a product when a proposal is resolved
 * (PRD US-2.2, ADR-0015). Ports inside the catalogue transaction; M4 adds the reservation
 * side (price snapshots, cancellations).
 */
export interface CatalogLifecycle {
  /** Fill only empty price snapshots of open reservations; return requesters for N5. */
  resolvePrice(tx: Transaction, product: Product, at: Date): Promise<string[]>;
  /** Transfer downstream references before a pending proposal merges into a sheet product. */
  merge(tx: Transaction, pending: Product, target: Product, at: Date): Promise<void>;
  /** Withdraw/cancel downstream records; return affected members for N5. */
  reject(tx: Transaction, pending: Product, actorId: string, at: Date): Promise<string[]>;
  /** Whether any record still points at the product, which decides delete vs. archive. */
  isReferenced(tx: Transaction, product: Product): Promise<boolean>;
}

async function offersOf(tx: Transaction, product: Product) {
  return tx
    .select({ id: offers.id, producerId: offers.producerId, status: offers.status })
    .from(offers)
    .where(eq(offers.productId, product.id));
}

export const catalogLifecycle: CatalogLifecycle = {
  resolvePrice: async () => [],

  /**
   * ADR-0015: the proposal's offers move to the sheet product, history included. A producer
   * who already has an active offer on the target would end up with two, and combining their
   * quantities, notes and dates is not ours to invent: the rename is refused instead.
   */
  merge: async (tx, pending, target) => {
    const moving = await offersOf(tx, pending);
    const activeProducers = moving.filter((o) => o.status === 'active').map((o) => o.producerId);
    if (activeProducers.length > 0) {
      const [clash] = await tx
        .select({ id: offers.id })
        .from(offers)
        .where(
          and(
            eq(offers.productId, target.id),
            eq(offers.status, 'active'),
            inArray(offers.producerId, activeProducers),
          ),
        )
        .limit(1);
      if (clash) throw conflict({ reason: 'offer_conflict', productId: target.id });
    }
    if (moving.length > 0) {
      await tx.update(offers).set({ productId: target.id }).where(eq(offers.productId, pending.id));
    }
  },

  /**
   * PRD US-2.2: offers on a rejected proposal are withdrawn; their producers are told (N5).
   * Reservations follow in M4.
   */
  reject: async (tx, pending, _actorId, at) => {
    const active = (await offersOf(tx, pending)).filter((o) => o.status === 'active');
    if (active.length > 0) {
      await tx
        .update(offers)
        .set({ status: 'withdrawn', updatedAt: at })
        .where(
          inArray(
            offers.id,
            active.map((o) => o.id),
          ),
        );
    }
    return [...new Set(active.map((o) => o.producerId))];
  },

  isReferenced: async (tx, product) => (await offersOf(tx, product)).length > 0,
};
