import { and, desc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import {
  createReservationSchema,
  isQuantityOnStep,
  localDateString,
  reservationActionBodySchema,
  RESERVATION_ACTIVE_STATUSES,
  RESERVATION_CLOSED_STATUSES,
  RESERVATION_CLOSED_WINDOW_DAYS,
  type CreateReservation,
  type ReservationAction,
  type ReservationActionBody,
  type ReservationsQuery,
} from '@agrobot/shared';
import type { Database, Transaction } from '../../db/client.js';
import { members, offers, reservations, type Member } from '../../db/schema/index.js';
import { inList } from '../../db/schema/sql.js';
import {
  AppError,
  forbidden,
  invalidTransition,
  notFound,
  validationFailed,
} from '../../errors.js';
import { assertMember } from '../members/service.js';
import { enqueueNotification } from '../notifications/outbox.js';
import { noopHub, type HubPort } from '../ports.js';
import { loadSettings } from '../settings/service.js';
import { notifyClosed, reservationPayload, writeSystemLine } from './notify.js';
import {
  approvedMemberIds,
  loadOfferToReserve,
  loadRecord,
  lockOfferRow,
  lockReservation,
  selectRecords,
  toRecord,
  type ReservationRecord,
} from './queries.js';
import {
  canAct,
  expiresAtFor,
  otherParty,
  partyMayEver,
  partyOf,
  whyNotReservable,
  type Party,
} from './rules.js';

/**
 * Reservations (PRD §8; ARCH §5 "delivered deducts, everything else releases", §6 reservation
 * machine, §9 deadline jobs, §11). Every mutation is one transaction with its system line and
 * its outbox rows (ADR-0009), re-reads the actor's row inside it, and locks the rows it
 * changes: the offer when quantity is at stake, the reservation on every transition. After the
 * commit the hub is woken when a notification or a deadline was written and told what changed
 * (ARCH §7, §8; ADR-0017). The bot's quick actions call the same functions as the API, so the
 * party and status guards live here and nowhere else (ARCH §17).
 */
export interface ReservationsDeps {
  db: Database;
  hub?: HubPort;
  now?: () => Date;
}

export type ReservationsService = ReturnType<typeof createReservationsService>;

interface Effects {
  /** Notification rows written; the hub is woken when there are any (ARCH §8 step 2). */
  notified: number;
  /** ARCH §7 `reservation.changed` for these reservations, to these members. */
  changed: Array<{ id: string; memberIds: string[] }>;
  /** ARCH §7 `board.changed`: availability moved, so every open board refetches. */
  boardAudience: string[];
}

export function createReservationsService(deps: ReservationsDeps) {
  const now = deps.now ?? (() => new Date());
  const hub = deps.hub ?? noopHub;
  const today = (at: Date) => localDateString(at);

  /** The actor as the database has them right now; locked when they are about to write. */
  async function actorFrom(tx: Transaction, actor: Member, lock: boolean): Promise<Member> {
    const query = tx.select().from(members).where(eq(members.id, actor.id));
    const [fresh] = await (lock ? query.for('update') : query.for('share'));
    if (!fresh) throw notFound();
    assertMember(fresh);
    return fresh;
  }

  const parties = (record: ReservationRecord) => [record.requester.id, record.producer.id];

  /** ARCH §7, §8, §9: what happens once the transaction has committed, and only then. */
  function afterCommit(effects: Effects, deadlineMoved = false): void {
    if (effects.notified > 0 || deadlineMoved) hub.wake();
    for (const change of effects.changed) {
      hub.publish(change.memberIds, { type: 'reservation.changed', id: change.id });
    }
    if (effects.boardAudience.length > 0) {
      hub.publish(effects.boardAudience, { type: 'board.changed' });
    }
  }

  /**
   * PRD US-4.1: reserve. The offer row is locked first and its `held` read in a second
   * statement, so two people reserving the last crate serialize and the second one is told
   * exactly what is left (`INSUFFICIENT_AVAILABILITY {available}`). The reservation starts
   * pending with the price snapshot and `expires_at`, the producer gets N6, the thread gets
   * its first system line, and the hub is woken for both the notification and the deadline.
   */
  async function create(actor: Member, input: CreateReservation): Promise<ReservationRecord> {
    const parsed = createReservationSchema.safeParse(input);
    if (!parsed.success) throw validationFailed(parsed.error.flatten());
    const body = parsed.data;

    const { record, effects } = await deps.db.transaction(async (tx) => {
      const at = now();
      const requester = await actorFrom(tx, actor, true);
      await lockOfferRow(tx, body.offerId);
      const target = await loadOfferToReserve(tx, body.offerId);

      const why = whyNotReservable(
        {
          status: target.offer.status,
          availableUntil: target.offer.availableUntil,
          producerId: target.offer.producerId,
          producerStatus: target.producer.status,
        },
        requester.id,
        today(at),
      );
      if (why === 'own_offer') throw forbidden({ reason: why });
      if (why) throw invalidTransition({ reason: why, offerId: target.offer.id });
      if (!isQuantityOnStep(body.quantity, target.product.unitCode)) {
        throw validationFailed({ quantity: 'step', unitCode: target.product.unitCode });
      }
      if (body.quantity > target.available) {
        throw new AppError('INSUFFICIENT_AVAILABILITY', {
          params: { available: target.available },
          details: { available: target.available },
        });
      }

      const settings = await loadSettings(tx);
      const [inserted] = await tx
        .insert(reservations)
        .values({
          offerId: target.offer.id,
          requesterId: requester.id,
          producerId: target.offer.producerId,
          quantity: String(body.quantity),
          unitPriceCents: target.product.priceCents,
          status: 'pending',
          expiresAt: expiresAtFor(at, settings.reservation_expiry_hours),
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: reservations.id });
      const record = await loadRecord(tx, inserted!.id);
      await writeSystemLine(
        tx,
        record.reservation.id,
        {
          event: 'created',
          actorId: requester.id,
          actorName: requester.displayName,
          reason: null,
          cause: null,
        },
        at,
      );
      const n6 = await enqueueNotification(tx, {
        memberId: record.producer.id,
        kind: 'N6',
        payload: reservationPayload(record),
      });
      const effects: Effects = {
        notified: n6 ? 1 : 0,
        changed: [{ id: record.reservation.id, memberIds: parties(record) }],
        boardAudience: await approvedMemberIds(tx),
      };
      return { record, effects };
    });
    afterCommit(effects, true);
    return record;
  }

  /**
   * ARCH §6: confirm, reject, cancel, deliver and confirm-and-deliver share one path: lock the
   * reservation, check who the actor is and what the status allows, apply the row change, write
   * the system line(s) and N8 to the other party. Delivering also locks the offer and subtracts
   * the quantity from it (ARCH §5), so the reservation stops being *held* and becomes *gone*.
   */
  async function act(
    actor: Member,
    reservationId: string,
    action: ReservationAction,
    body: ReservationActionBody = {},
  ): Promise<ReservationRecord> {
    const parsed = reservationActionBodySchema.safeParse(body);
    if (!parsed.success) throw validationFailed(parsed.error.flatten());
    const reason = action === 'reject' || action === 'cancel' ? (parsed.data.reason ?? null) : null;

    const { record, effects } = await deps.db.transaction(async (tx) => {
      const at = now();
      const member = await actorFrom(tx, actor, true);
      await lockReservation(tx, reservationId);
      const before = await loadRecord(tx, reservationId);
      const party = partyOf(before.reservation, member.id);
      if (!party) throw forbidden({ reason: 'not_party' });
      if (!partyMayEver(party, action)) throw forbidden({ reason: 'not_for_party', party });
      if (!canAct(before.reservation.status, party, action)) {
        throw invalidTransition({ action, status: before.reservation.status });
      }

      const actorMeta = { actorId: member.id, actorName: member.displayName, cause: null };
      const line = (event: 'confirmed' | 'rejected' | 'cancelled' | 'delivered') =>
        writeSystemLine(tx, reservationId, { event, reason, ...actorMeta }, at);
      const closing = { reason, closedBy: member.id, closedAt: at, expiresAt: null, updatedAt: at };
      let releases = false;

      switch (action) {
        case 'confirm':
          await tx
            .update(reservations)
            .set({ status: 'confirmed', confirmedAt: at, expiresAt: null, updatedAt: at })
            .where(eq(reservations.id, reservationId));
          await line('confirmed');
          break;
        case 'reject':
          await tx
            .update(reservations)
            .set({ status: 'rejected', ...closing })
            .where(eq(reservations.id, reservationId));
          await line('rejected');
          releases = true;
          break;
        case 'cancel':
          await tx
            .update(reservations)
            .set({ status: 'cancelled', ...closing })
            .where(eq(reservations.id, reservationId));
          await line('cancelled');
          releases = true;
          break;
        case 'deliver':
          await deduct(tx, before, at);
          await tx
            .update(reservations)
            .set({ status: 'delivered', deliveredAt: at, ...closing })
            .where(eq(reservations.id, reservationId));
          await line('delivered');
          break;
        case 'confirm-and-deliver':
          // ADR-0014: the two-step path in one transaction; both lines, one notification.
          await deduct(tx, before, at);
          await tx
            .update(reservations)
            .set({ status: 'delivered', confirmedAt: at, deliveredAt: at, ...closing })
            .where(eq(reservations.id, reservationId));
          await line('confirmed');
          await line('delivered');
          break;
      }

      const record = await loadRecord(tx, reservationId);
      const notified = await notifyClosed(tx, record, {
        decision: record.reservation.status as 'confirmed' | 'rejected' | 'cancelled' | 'delivered',
        actorName: member.displayName,
        reason,
        cause: null,
        recipients: [otherParty(party)],
      });
      const effects: Effects = {
        notified,
        changed: [{ id: reservationId, memberIds: parties(record) }],
        // A release puts quantity back on the board; a delivery changes the producer's totals.
        boardAudience: releases || action !== 'confirm' ? await approvedMemberIds(tx) : [],
      };
      return { record, effects };
    });
    afterCommit(effects);
    return record;
  }

  /** ARCH §5: delivered deducts. Locks the offer row (after the reservation, always). */
  async function deduct(tx: Transaction, record: ReservationRecord, at: Date): Promise<void> {
    await lockOfferRow(tx, record.offer.id);
    await tx
      .update(offers)
      .set({
        quantity: sql`${offers.quantity} - ${String(record.quantity)}::numeric`,
        updatedAt: at,
      })
      .where(eq(offers.id, record.offer.id));
  }

  /** ARCH §11 `GET /reservations/:id`: a party's view; anyone else is refused. */
  async function get(actor: Member, reservationId: string): Promise<ReservationRecord> {
    return deps.db.transaction(async (tx) => {
      const member = await actorFrom(tx, actor, false);
      const record = await loadRecord(tx, reservationId);
      if (!partyOf(record.reservation, member.id)) throw forbidden({ reason: 'not_party' });
      return record;
    });
  }

  /**
   * PRD US-4.6: incoming (I am the producer) or outgoing (I am the requester); active
   * (pending, confirmed) or closed (the rest, last 30 days). Newest first.
   */
  async function list(actor: Member, query: ReservationsQuery): Promise<ReservationRecord[]> {
    return deps.db.transaction(async (tx) => {
      const member = await actorFrom(tx, actor, false);
      const mine =
        query.side === 'incoming'
          ? eq(reservations.producerId, member.id)
          : eq(reservations.requesterId, member.id);
      if (query.state === 'active') {
        const rows = await selectRecords(tx)
          .where(and(mine, inList(reservations.status, RESERVATION_ACTIVE_STATUSES)))
          .orderBy(desc(reservations.createdAt));
        return rows.map(toRecord);
      }
      const since = new Date(now().getTime() - RESERVATION_CLOSED_WINDOW_DAYS * 86_400_000);
      const rows = await selectRecords(tx)
        .where(
          and(
            mine,
            inList(reservations.status, RESERVATION_CLOSED_STATUSES),
            gte(reservations.closedAt, since),
          ),
        )
        .orderBy(desc(reservations.closedAt));
      return rows.map(toRecord);
    });
  }

  /**
   * ARCH §9 `reservations.remind` (PRD US-4.5): N7 to the producer once a pending, un-reminded
   * reservation is within `reservation_reminder_hours_before_expiry` of its deadline. `reminded_at`
   * makes it run once per reservation however often the alarm fires.
   */
  async function remind(at: Date): Promise<{ reminded: number }> {
    const notified = await deps.db.transaction(async (tx) => {
      const settings = await loadSettings(tx);
      const threshold = new Date(
        at.getTime() + settings.reservation_reminder_hours_before_expiry * 3_600_000,
      );
      const rows = await selectRecords(tx)
        .where(
          and(
            eq(reservations.status, 'pending'),
            isNull(reservations.remindedAt),
            isNotNull(reservations.expiresAt),
            lte(reservations.expiresAt, threshold),
          ),
        )
        .for('update', { of: reservations });
      let notified = 0;
      for (const row of rows.map(toRecord)) {
        await tx
          .update(reservations)
          .set({ remindedAt: at })
          .where(eq(reservations.id, row.reservation.id));
        const n7 = await enqueueNotification(tx, {
          memberId: row.producer.id,
          kind: 'N7',
          payload: {
            ...reservationPayload(row),
            expiresAt: row.reservation.expiresAt!.toISOString(),
          },
        });
        if (n7) notified += 1;
      }
      return notified;
    });
    afterCommit({ notified, changed: [], boardAudience: [] });
    return { reminded: notified };
  }

  /**
   * ARCH §9 `reservations.expire` (PRD US-4.5): pending reservations past `expires_at` become
   * expired, release their quantity, get a system line and N8 to both parties. Idempotent: an
   * expired row is no longer pending.
   */
  async function expire(at: Date): Promise<{ expired: number }> {
    const { expired, effects } = await deps.db.transaction(async (tx) => {
      const rows = await selectRecords(tx)
        .where(
          and(
            eq(reservations.status, 'pending'),
            isNotNull(reservations.expiresAt),
            lte(reservations.expiresAt, at),
          ),
        )
        .for('update', { of: reservations });
      const effects: Effects = { notified: 0, changed: [], boardAudience: [] };
      for (const row of rows.map(toRecord)) {
        await tx
          .update(reservations)
          .set({ status: 'expired', closedAt: at, updatedAt: at })
          .where(eq(reservations.id, row.reservation.id));
        await writeSystemLine(
          tx,
          row.reservation.id,
          { event: 'expired', actorId: null, actorName: null, reason: null, cause: null },
          at,
        );
        effects.notified += await notifyClosed(tx, row, {
          decision: 'expired',
          actorName: null,
          reason: null,
          cause: null,
          recipients: ['requester', 'producer'] satisfies Party[],
        });
        effects.changed.push({ id: row.reservation.id, memberIds: parties(row) });
      }
      if (rows.length > 0) effects.boardAudience = await approvedMemberIds(tx);
      return { expired: rows.length, effects };
    });
    afterCommit(effects);
    return { expired };
  }

  return { create, act, get, list, remind, expire };
}
