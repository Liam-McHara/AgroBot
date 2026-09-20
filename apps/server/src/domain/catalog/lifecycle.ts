import { and, eq, inArray } from 'drizzle-orm';
import type { Transaction } from '../../db/client.js';
import { offers, type Product } from '../../db/schema/index.js';
import { conflict } from '../../errors.js';
import {
  cancelReservationsOfProduct,
  resolveReservationPrices,
  type CancelledReservations,
} from '../reservations/cascade.js';

/**
 * What the catalogue does to the records that hang off a product when a proposal is resolved
 * (PRD US-2.2, ADR-0015, ADR-0018). Ports inside the catalogue transaction: offers here, the
 * reservation side in `domain/reservations/cascade.ts`.
 */
export interface RejectOutcome extends CancelledReservations {
  /** Producers of the withdrawn offers, for N5. */
  producerIds: string[];
}

export interface CatalogLifecycle {
  /** Fill only empty price snapshots of open reservations; return requesters for N5. */
  resolvePrice(tx: Transaction, product: Product, at: Date): Promise<string[]>;
  /** Transfer downstream references before a pending proposal merges into a sheet product. */
  merge(tx: Transaction, pending: Product, target: Product, at: Date): Promise<void>;
  /** Cancel open reservations and withdraw offers; return who and what was affected. */
  reject(tx: Transaction, pending: Product, actorId: string, at: Date): Promise<RejectOutcome>;
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
  /** ARCH §6 `price-resolve`: open reservations without a snapshot take the new price. */
  resolvePrice: resolveReservationPrices,

  /**
   * ADR-0015: the proposal's offers move to the sheet product, history included, and their
   * reservations follow them by reference. A producer who already has an active offer on the
   * target would end up with two, and combining their quantities, notes and dates is not ours
   * to invent: the rename is refused instead.
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
   * PRD US-2.2: the open reservations on a rejected proposal are cancelled (N8 to both parties,
   * reservations locked first), then its active offers are withdrawn; their producers are told
   * with N5.
   */
  reject: async (tx, pending, actorId, at) => {
    const cancelled = await cancelReservationsOfProduct(tx, pending, actorId, at);
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
    return { ...cancelled, producerIds: [...new Set(active.map((o) => o.producerId))] };
  },

  /** Reservations reference offers, never the product, so offers alone decide. */
  isReferenced: async (tx, product) => (await offersOf(tx, product)).length > 0,
};
