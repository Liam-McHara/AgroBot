import {
  parseQuantity,
  productSchema,
  type AdminMember,
  type BoardGrouping,
  type BoardView,
  type Invite,
  type Me,
  type MyOfferView,
  type OfferDetailView,
  type OfferView,
  type Settings,
} from '@agrobot/shared';
import type { Member } from '../db/schema/index.js';
import type { InviteView } from '../domain/members/service.js';
import type { BoardResult, OfferRecord } from '../domain/offers/service.js';

/** Rows → the shared contracts. Nothing leaves the API that is not in a schema. */

export function toMe(member: Member, settings: Settings): Me {
  return {
    id: member.id,
    telegramId: String(member.telegramId),
    username: member.username,
    displayName: member.displayName,
    language: member.language,
    role: member.role,
    status: member.status,
    settings,
  };
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
