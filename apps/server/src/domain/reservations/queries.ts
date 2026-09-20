import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { parseQuantity, RESERVATION_HOLDING_STATUSES } from '@agrobot/shared';
import type { Transaction } from '../../db/client.js';
import {
  members,
  offers,
  products,
  reservations,
  type Member,
  type Offer,
  type Product,
  type Reservation,
} from '../../db/schema/index.js';
import { inList } from '../../db/schema/sql.js';
import { notFound } from '../../errors.js';
import { availableOf } from '../offers/rules.js';

/**
 * The reads the reservation code shares (service, jobs and the catalogue cascade): a
 * reservation with its offer, product and both parties, and an offer with what is held on it.
 * `held` and `available` are computed in the query, never stored (ARCH §5).
 */

export interface PartyRow {
  id: string;
  displayName: string;
  username: string | null;
  status: Member['status'];
}

export interface ReservationRecord {
  reservation: Reservation;
  offer: Offer;
  product: Product;
  requester: PartyRow;
  producer: PartyRow;
  /** The reservation's quantity as a number. */
  quantity: number;
  /** ARCH §5: what is left on the offer as of this read. */
  offerAvailable: number;
}

const requesterAlias = alias(members, 'requester');
const producerAlias = alias(members, 'producer');
/** The inner name for "the reservations that hold quantity on this offer". */
const holding = alias(reservations, 'holding');

/** Σ quantity of pending and confirmed reservations on the offer of the outer query. */
export const heldSql = sql<string>`coalesce((select sum(${holding.quantity})
  from ${reservations} as ${holding}
  where ${holding.offerId} = ${offers.id}
    and ${inList(holding.status, RESERVATION_HOLDING_STATUSES)}), 0)`;

const selection = {
  reservation: reservations,
  offer: offers,
  product: products,
  requester: {
    id: requesterAlias.id,
    displayName: requesterAlias.displayName,
    username: requesterAlias.username,
    status: requesterAlias.status,
  },
  producer: {
    id: producerAlias.id,
    displayName: producerAlias.displayName,
    username: producerAlias.username,
    status: producerAlias.status,
  },
  offerHeld: heldSql,
};

type Row = {
  reservation: Reservation;
  offer: Offer;
  product: Product;
  requester: PartyRow;
  producer: PartyRow;
  offerHeld: string | number;
};

export function toRecord(row: Row): ReservationRecord {
  return {
    reservation: row.reservation,
    offer: row.offer,
    product: row.product,
    requester: row.requester,
    producer: row.producer,
    quantity: parseQuantity(row.reservation.quantity),
    offerAvailable: availableOf({
      quantity: parseQuantity(row.offer.quantity),
      held: parseQuantity(row.offerHeld),
    }),
  };
}

export function selectRecords(tx: Transaction) {
  return tx
    .select(selection)
    .from(reservations)
    .innerJoin(offers, eq(offers.id, reservations.offerId))
    .innerJoin(products, eq(products.id, offers.productId))
    .innerJoin(requesterAlias, eq(requesterAlias.id, reservations.requesterId))
    .innerJoin(producerAlias, eq(producerAlias.id, reservations.producerId));
}

export async function loadRecord(
  tx: Transaction,
  reservationId: string,
): Promise<ReservationRecord> {
  const [row] = await selectRecords(tx).where(eq(reservations.id, reservationId));
  if (!row) throw notFound({ reservationId });
  return toRecord(row);
}

/** `SELECT … FOR UPDATE` on one row, and nothing else: the read comes in a statement of its own. */
export async function lockReservation(tx: Transaction, reservationId: string): Promise<void> {
  const [row] = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .for('update');
  if (!row) throw notFound({ reservationId });
}

export async function lockOfferRow(tx: Transaction, offerId: string): Promise<void> {
  const [row] = await tx
    .select({ id: offers.id })
    .from(offers)
    .where(eq(offers.id, offerId))
    .for('update');
  if (!row) throw notFound({ offerId });
}

export interface OfferToReserve {
  offer: Offer;
  product: Product;
  producer: Pick<PartyRow, 'id' | 'displayName' | 'status'>;
  held: number;
  available: number;
}

/**
 * The offer with what is held on it. Called *after* `lockOfferRow` in a statement of its own:
 * under READ COMMITTED each statement takes a fresh snapshot, so the sum sees every
 * reservation committed while we waited for the lock (PRD principle 2).
 */
export async function loadOfferToReserve(
  tx: Transaction,
  offerId: string,
): Promise<OfferToReserve> {
  const [row] = await tx
    .select({
      offer: offers,
      product: products,
      producer: { id: members.id, displayName: members.displayName, status: members.status },
      held: heldSql,
    })
    .from(offers)
    .innerJoin(products, eq(products.id, offers.productId))
    .innerJoin(members, eq(members.id, offers.producerId))
    .where(eq(offers.id, offerId));
  if (!row) throw notFound({ offerId });
  const held = parseQuantity(row.held);
  const quantity = parseQuantity(row.offer.quantity);
  return { ...row, held, available: availableOf({ quantity, held }) };
}

export async function approvedMemberIds(tx: Transaction): Promise<string[]> {
  const rows = await tx
    .select({ id: members.id })
    .from(members)
    .where(eq(members.status, 'approved'));
  return rows.map((row) => row.id);
}
