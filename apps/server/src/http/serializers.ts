import {
  parseQuantity,
  productSchema,
  systemLineMetaSchema,
  totalCents,
  type AdminMember,
  type BoardGrouping,
  type BoardView,
  type Invite,
  type Me,
  type MessageView,
  type MyOfferView,
  type OfferDetailView,
  type OfferView,
  type ReservationDetailView,
  type ReservationParty,
  type ReservationView,
  type Settings,
  type UnreadCounts,
} from '@agrobot/shared';
import type { Member } from '../db/schema/index.js';
import type { InviteView } from '../domain/members/service.js';
import type { BoardResult, OfferRecord } from '../domain/offers/service.js';
import type { PartyRow, ReservationRecord } from '../domain/reservations/queries.js';
import { allowedActions, partyOf } from '../domain/reservations/rules.js';
import type { MessageRecord, ThreadSummary } from '../domain/threads/service.js';

/** Rows → the shared contracts. Nothing leaves the API that is not in a schema. */

export function toMe(member: Member, settings: Settings, unread: UnreadCounts): Me {
  return {
    id: member.id,
    telegramId: String(member.telegramId),
    username: member.username,
    displayName: member.displayName,
    language: member.language,
    role: member.role,
    status: member.status,
    settings,
    unread: toUnreadCounts(unread),
  };
}

/** PRD US-4.6: the three badge figures, and nothing else a summary may carry. */
export function toUnreadCounts(unread: UnreadCounts): UnreadCounts {
  return { total: unread.total, incoming: unread.incoming, outgoing: unread.outgoing };
}

export function toAdminMember(member: Member): AdminMember {
  return {
    id: member.id,
    telegramId: String(member.telegramId),
    username: member.username,
    firstName: member.firstName,
    lastName: member.lastName,
    displayName: member.displayName,
    language: member.language,
    role: member.role,
    status: member.status,
    appliedAt: member.appliedAt.toISOString(),
    approvedAt: member.approvedAt?.toISOString() ?? null,
    lastSeenAt: member.lastSeenAt?.toISOString() ?? null,
  };
}

export function toInvite(invite: InviteView): Invite {
  return {
    id: invite.id,
    telegramId: invite.telegramId === null ? null : String(invite.telegramId),
    username: invite.username,
    createdAt: invite.createdAt.toISOString(),
    createdByName: invite.createdByName,
    usedAt: invite.usedAt?.toISOString() ?? null,
    usedByName: invite.usedByName,
  };
}

/** PRD US-3.3: what any member sees of an offer. Totals stay with the producer. */
export function toOffer(record: OfferRecord): OfferView {
  return {
    id: record.offer.id,
    product: productSchema.parse(record.product),
    producer: { id: record.producer.id, displayName: record.producer.displayName },
    available: record.available,
    availableUntil: record.offer.availableUntil,
    note: record.offer.note,
    status: record.offer.status,
    stale: record.offer.stale,
    createdAt: record.offer.createdAt.toISOString(),
    updatedAt: record.offer.updatedAt.toISOString(),
  };
}

/** The producer's own view: totals, held, and where the nudge cycle stands (US-3.2, US-3.4). */
export function toMyOffer(record: OfferRecord): MyOfferView {
  return {
    ...toOffer(record),
    quantity: parseQuantity(record.offer.quantity),
    held: record.held,
    openReservations: record.openReservations,
    lastActivityAt: record.offer.lastActivityAt.toISOString(),
    nudgedAt: record.offer.nudgedAt?.toISOString() ?? null,
  };
}

/** `GET /offers/:id`: the producer's fields for the producer, `null` for everyone else. */
export function toOfferDetail(record: OfferRecord, viewer: Member): OfferDetailView {
  const mine = record.producer.id === viewer.id;
  return {
    ...toOffer(record),
    quantity: mine ? parseQuantity(record.offer.quantity) : null,
    held: mine ? record.held : null,
    openReservations: mine ? record.openReservations : null,
    nudgedAt: mine ? (record.offer.nudgedAt?.toISOString() ?? null) : null,
  };
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

const toParty = (row: PartyRow): ReservationParty => ({
  id: row.id,
  displayName: row.displayName,
  username: row.username,
});

/**
 * PRD US-4.6: a reservation as one of its parties sees it, with the side they are on, the
 * actions ARCH §6 allows them right now and their unread messages in its thread (US-5.1). The
 * domain has already refused anyone who is not a party; a viewer who somehow is not one reads
 * it as the requester would and gets no actions.
 */
export function toReservation(
  record: ReservationRecord,
  viewer: Member,
  unread: number,
): ReservationView {
  const { reservation } = record;
  const party = partyOf(reservation, viewer.id);
  const asProducer = party === 'producer';
  return {
    id: reservation.id,
    offerId: reservation.offerId,
    product: productSchema.parse(record.product),
    quantity: record.quantity,
    unitPriceCents: reservation.unitPriceCents,
    currency: 'EUR',
    totalCents: totalCents(record.quantity, reservation.unitPriceCents),
    status: reservation.status,
    side: asProducer ? 'incoming' : 'outgoing',
    requester: toParty(record.requester),
    producer: toParty(record.producer),
    counterpart: toParty(asProducer ? record.requester : record.producer),
    reason: reservation.reason,
    expiresAt: iso(reservation.expiresAt),
    createdAt: reservation.createdAt.toISOString(),
    confirmedAt: iso(reservation.confirmedAt),
    deliveredAt: iso(reservation.deliveredAt),
    closedAt: iso(reservation.closedAt),
    updatedAt: reservation.updatedAt.toISOString(),
    actions: party ? allowedActions(reservation.status, party) : [],
    unread,
  };
}

/**
 * `GET /reservations/:id` and every mutation: the reservation, the offer behind it and where
 * its thread stands for the viewer (PRD US-5.1).
 */
export function toReservationDetail(
  record: ReservationRecord,
  viewer: Member,
  thread: ThreadSummary,
): ReservationDetailView {
  return {
    ...toReservation(record, viewer, thread.unread),
    offer: {
      id: record.offer.id,
      status: record.offer.status,
      note: record.offer.note,
      availableUntil: record.offer.availableUntil,
      available: record.offerAvailable,
    },
    thread: { writable: thread.writable, writableUntil: iso(thread.writableUntil) },
  };
}

/**
 * PRD US-5.1: one line of a thread. A system line's `meta` is validated on the way out; one
 * that does not parse is shown as a bare line rather than failing the whole page.
 */
export function toMessage(record: MessageRecord, viewer: Member): MessageView {
  const { message } = record;
  const meta = message.kind === 'system' ? systemLineMetaSchema.safeParse(message.meta) : null;
  return {
    id: message.id,
    reservationId: message.reservationId,
    kind: message.kind,
    body: message.body,
    sender: record.sender,
    mine: message.senderId !== null && message.senderId === viewer.id,
    meta: meta?.success ? meta.data : null,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toBoard(result: BoardResult, group: BoardGrouping): BoardView {
  return {
    group,
    groups: result.groups.map((g) => ({
      key: g.key,
      name: g.name,
      nameEs: g.nameEs,
      offers: g.offers.map(toOffer),
    })),
    categories: result.categories,
    total: result.total,
  };
}
