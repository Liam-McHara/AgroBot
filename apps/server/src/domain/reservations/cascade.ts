import { and, eq, inArray, isNull } from 'drizzle-orm';
import { RESERVATION_HOLDING_STATUSES } from '@agrobot/shared';
import type { Transaction } from '../../db/client.js';
import { offers, reservations, type Product } from '../../db/schema/index.js';
import { inList } from '../../db/schema/sql.js';
import { notifyClosed, writeSystemLine } from './notify.js';
import { approvedMemberIds, selectRecords, toRecord } from './queries.js';

/**
 * The reservation side of the catalogue lifecycle (PRD US-2.2; ADR-0015, ADR-0018): what
 * happens to reservations when a pending product is resolved or rejected. Runs inside the
 * catalogue's transaction, under its advisory lock.
 */

/**
 * ARCH §6 `price-resolve`: open reservations whose snapshot is still empty take the product's
 * price now that it has one; closed ones keep their history as it was. Returns the requesters
 * to tell (N5).
 */
export async function resolveReservationPrices(
  tx: Transaction,
  product: Product,
  at: Date,
): Promise<string[]> {
  if (product.priceCents === null) return [];
  const rows = await tx
    .update(reservations)
    .set({ unitPriceCents: product.priceCents, updatedAt: at })
    .from(offers)
    .where(
      and(
        eq(reservations.offerId, offers.id),
        eq(offers.productId, product.id),
        isNull(reservations.unitPriceCents),
        inList(reservations.status, RESERVATION_HOLDING_STATUSES),
      ),
    )
    .returning({ requesterId: reservations.requesterId });
  return [...new Set(rows.map((row) => row.requesterId))];
}

export interface CancelledReservations {
  /** `reservation.changed` to publish after the commit (ARCH §7). */
  changed: Array<{ id: string; memberIds: string[] }>;
  /** N8 rows written; the caller wakes the hub. */
  notified: number;
  /** Boards to refetch, when anything was released. */
  boardAudience: string[];
}

/**
 * PRD US-2.2 reject: the open reservations on the product's offers are cancelled before the
 * offers are withdrawn (reservations are always locked before offers, ARCH §6 `deliver` does
 * the same, so the two can never deadlock). Both parties get N8 saying why; the admin is not a
 * party, so the system line names no actor.
 */
export async function cancelReservationsOfProduct(
  tx: Transaction,
  product: Product,
  actorId: string,
  at: Date,
): Promise<CancelledReservations> {
  const productOffers = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(eq(offers.productId, product.id));
  const outcome: CancelledReservations = { changed: [], notified: 0, boardAudience: [] };
  if (productOffers.length === 0) return outcome;
  const rows = await selectRecords(tx)
    .where(
      and(
        inArray(
          reservations.offerId,
          productOffers.map((offer) => offer.id),
        ),
        inList(reservations.status, RESERVATION_HOLDING_STATUSES),
      ),
    )
    .for('update', { of: reservations });
  for (const record of rows.map(toRecord)) {
    await tx
      .update(reservations)
      .set({
        status: 'cancelled',
        reason: null,
        closedBy: actorId,
        closedAt: at,
        expiresAt: null,
        updatedAt: at,
      })
      .where(eq(reservations.id, record.reservation.id));
    await writeSystemLine(
      tx,
      record.reservation.id,
      {
        event: 'cancelled',
        actorId: null,
        actorName: null,
        reason: null,
        cause: 'product_rejected',
      },
      at,
    );
    outcome.notified += await notifyClosed(tx, record, {
      decision: 'cancelled',
      actorName: null,
      reason: null,
      cause: 'product_rejected',
      recipients: ['requester', 'producer'],
    });
    outcome.changed.push({
      id: record.reservation.id,
      memberIds: [record.requester.id, record.producer.id],
    });
  }
  if (rows.length > 0) outcome.boardAudience = await approvedMemberIds(tx);
  return outcome;
}
