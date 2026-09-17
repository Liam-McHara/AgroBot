import { eq } from 'drizzle-orm';
import type { Transaction } from '../../db/client.js';
import { offers, type Product } from '../../db/schema/index.js';
import { conflict } from '../../errors.js';

/** M3/M4 extend these ports inside the catalogue transaction (roadmap M2). */
export interface CatalogLifecycle {
  /** Fill only empty price snapshots of open reservations; return requesters for N5. */
  resolvePrice(tx: Transaction, product: Product, at: Date): Promise<string[]>;
  /** Transfer downstream references before a pending proposal merges into a sheet product. */
  merge(tx: Transaction, pending: Product, target: Product, at: Date): Promise<void>;
  /** Withdraw/cancel downstream records; return affected members for N5. */
  reject(tx: Transaction, pending: Product, actorId: string, at: Date): Promise<string[]>;
}

async function assertUnreferenced(tx: Transaction, product: Product): Promise<void> {
  const [offer] = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(eq(offers.productId, product.id))
    .limit(1);
  // Offer publication arrives in M3. Until its cascade is wired, fail safely on seeded data.
  if (offer) throw conflict({ reason: 'catalogue_cascade_not_available', productId: product.id });
}
export const catalogLifecycle: CatalogLifecycle = {
  resolvePrice: async () => [],
  merge: async (tx, pending) => assertUnreferenced(tx, pending),
  reject: async (tx, pending) => {
    await assertUnreferenced(tx, pending);
    return [];
  },
};
