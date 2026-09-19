import { and, asc, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  editOfferSchema,
  isDateBefore,
  isQuantityOnStep,
  localDateString,
  parseQuantity,
  publishOfferSchema,
  RESERVATION_HOLDING_STATUSES,
  type BoardQuery,
  type EditOffer,
  type PublishOffer,
} from '@agrobot/shared';
import type { Database, Transaction } from '../../db/client.js';
import {
  members,
  offers,
  products,
  reservations,
  type Member,
  type Offer,
  type Product,
} from '../../db/schema/index.js';
import { inList } from '../../db/schema/sql.js';
import {
  AppError,
  forbidden,
  invalidTransition,
  notFound,
  validationFailed,
} from '../../errors.js';
import { assertMember } from '../members/service.js';
import { enqueueNotification, enqueueNotifications } from '../notifications/outbox.js';
import { noopHub, type HubPort } from '../ports.js';
import { loadSettings } from '../settings/service.js';
import {
  availableOf,
  compareBoardEntries,
  groupBoard,
  isRepublish,
  matchesSearch,
  statusAfterEdit,
  type BoardGroupOf,
  type OfferSnapshot,
} from './rules.js';

/**
 * Offers and the board (PRD §7; ARCH §5 derived rules, §6 offer machine, §11).
 *
 * Every mutation runs in one transaction with the notification rows it produces (ADR-0009)
 * and re-reads the actor's row inside it, so a stale copy can never authorize anything.
 * `held` and `available` are computed in the query, never stored (ARCH §5). After a commit
 * the hub is woken when something was enqueued and told `board.changed` for everyone whose
 * board may have moved (ARCH §7, §8; ADR-0017).
 */
export interface OffersDeps {
  db: Database;
  hub?: HubPort;
  now?: () => Date;
}

/** An offer with everything a screen or a notification needs about it. */
export interface OfferRecord {
  offer: Offer;
  product: Product;
  producer: { id: string; displayName: string; status: Member['status'] };
  /** Σ quantity of pending and confirmed reservations (ARCH §5). */
  held: number;
  available: number;
  /** How many reservations are pending or confirmed. */
  openReservations: number;
}

export interface BoardResult {
  groups: BoardGroupOf<OfferRecord & { stale: boolean }>[];
  categories: string[];
  total: number;
}

export type OffersService = ReturnType<typeof createOffersService>;

/** Quantity held by open reservations on the offer of the outer query. */
const heldSql = sql<string>`coalesce((select sum(${reservations.quantity}) from ${reservations}
  where ${reservations.offerId} = ${offers.id}
    and ${inList(reservations.status, RESERVATION_HOLDING_STATUSES)}), 0)`;

const openReservationsSql = sql<number>`(select count(*) from ${reservations}
  where ${reservations.offerId} = ${offers.id}
    and ${inList(reservations.status, RESERVATION_HOLDING_STATUSES)})::int`;

const selection = {
  offer: offers,
  product: products,
  producer: { id: members.id, displayName: members.displayName, status: members.status },
  held: heldSql,
  openReservations: openReservationsSql,
};

type Row = {
  offer: Offer;
  product: Product;
  producer: { id: string; displayName: string; status: Member['status'] };
  held: string | number;
  openReservations: number;
};

function toRecord(row: Row): OfferRecord {
  const held = parseQuantity(row.held);
  const quantity = parseQuantity(row.offer.quantity);
  return {
    offer: row.offer,
    product: row.product,
    producer: row.producer,
    held,
    available: availableOf({ quantity, held }),
    openReservations: row.openReservations,
  };
}

function snapshotOf(record: OfferRecord): OfferSnapshot {
  return {
    status: record.offer.status,
    quantity: parseQuantity(record.offer.quantity),
    held: record.held,
    availableUntil: record.offer.availableUntil,
  };
}

/** What the board sorts and groups on: the record plus the flag it reads most. */
function asEntry(record: OfferRecord): OfferRecord & { stale: boolean } {
  return { ...record, stale: record.offer.stale };
}

export function createOffersService(deps: OffersDeps) {
  const now = deps.now ?? (() => new Date());
  const hub = deps.hub ?? noopHub;
  const today = (at: Date) => localDateString(at);

  function selectRecords(tx: Transaction) {
    return tx
      .select(selection)
      .from(offers)
      .innerJoin(products, eq(products.id, offers.productId))
      .innerJoin(members, eq(members.id, offers.producerId));
  }

  /** The actor as the database has them right now; locked when they are about to write. */
  async function actorFrom(tx: Transaction, actor: Member, lock: boolean): Promise<Member> {
    const query = tx.select().from(members).where(eq(members.id, actor.id));
    const [fresh] = await (lock ? query.for('update') : query.for('share'));
    if (!fresh) throw notFound();
    assertMember(fresh);
    return fresh;
  }

  async function approvedMemberIds(tx: Transaction): Promise<string[]> {
    const rows = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.status, 'approved'));
    return rows.map((row) => row.id);
  }

  /** Lock the offer row (the reservation of M4 locks it the same way) and read it whole. */
  async function lockOffer(tx: Transaction, offerId: string): Promise<OfferRecord> {
    const [row] = await selectRecords(tx)
      .where(eq(offers.id, offerId))
      .for('update', { of: offers });
    if (!row) throw notFound({ offerId });
    return toRecord(row);
  }

  async function loadOffer(tx: Transaction, offerId: string): Promise<OfferRecord> {
    const [row] = await selectRecords(tx).where(eq(offers.id, offerId));
    if (!row) throw notFound({ offerId });
    return toRecord(row);
  }

  function assertProducer(record: OfferRecord, actor: Member): void {
    if (record.offer.producerId !== actor.id) throw forbidden({ reason: 'not_producer' });
  }

  function assertStep(quantity: number, product: Product): void {
    if (!isQuantityOnStep(quantity, product.unitCode)) {
      throw validationFailed({ quantity: 'step', unitCode: product.unitCode });
    }
  }

  function assertNotPast(availableUntil: string | null | undefined, at: Date): void {
    if (availableUntil != null && isDateBefore(availableUntil, today(at))) {
      throw validationFailed({ availableUntil: 'past' });
    }
  }

  /** PRD US-3.1: one active offer per (producer, product), reported with the existing id. */
  async function assertNoOtherActive(
    tx: Transaction,
    producerId: string,
    productId: string,
    exceptOfferId: string | null,
  ): Promise<void> {
    const [existing] = await tx
      .select({ id: offers.id })
      .from(offers)
      .where(
        and(
          eq(offers.producerId, producerId),
          eq(offers.productId, productId),
          eq(offers.status, 'active'),
          ...(exceptOfferId ? [ne(offers.id, exceptOfferId)] : []),
        ),
      )
      .limit(1);
    if (existing) throw new AppError('OFFER_ALREADY_ACTIVE', { details: { offerId: existing.id } });
  }

  /** N3 to every other approved member, if the group wants it (PRD US-3.1, N3). */
  async function announce(
    tx: Transaction,
    record: OfferRecord,
    republished: boolean,
  ): Promise<number> {
    const settings = await loadSettings(tx);
    if (!settings.notify_new_offer) return 0;
    const recipients = (await approvedMemberIds(tx)).filter((id) => id !== record.producer.id);
    return enqueueNotifications(tx, recipients, 'N3', {
      offerId: record.offer.id,
      productName: record.product.name,
      productNameEs: record.product.nameEs,
      unitCode: record.product.unitCode,
      producerName: record.producer.displayName,
      quantity: record.available,
      republished,
    });
  }

  /** After a commit: drain the outbox if it grew, and let every open board refetch. */
  function afterCommit(notified: number, audience: readonly string[]): void {
    if (notified > 0) hub.wake();
    if (audience.length > 0) hub.publish(audience, { type: 'board.changed' });
  }

  /** PRD US-3.1: publish. The product must be active or the producer's own pending one. */
  async function publish(actor: Member, input: PublishOffer): Promise<OfferRecord> {
    const parsed = publishOfferSchema.safeParse(input);
    if (!parsed.success) throw validationFailed(parsed.error.flatten());
    const body = parsed.data;

    const { record, notified, audience } = await deps.db.transaction(async (tx) => {
      const at = now();
      const producer = await actorFrom(tx, actor, true);
      const [product] = await tx.select().from(products).where(eq(products.id, body.productId));
      if (!product) throw notFound({ productId: body.productId });
      const offerable =
        product.status === 'active' ||
        (product.status === 'pending' && product.proposedBy === producer.id);
      if (!offerable) throw validationFailed({ productId: 'not_offerable' });
      assertStep(body.quantity, product);
      assertNotPast(body.availableUntil, at);
      await assertNoOtherActive(tx, producer.id, product.id, null);

      const [inserted] = await tx
        .insert(offers)
        .values({
          producerId: producer.id,
          productId: product.id,
          quantity: String(body.quantity),
          note: body.note ?? null,
          availableUntil: body.availableUntil ?? null,
          status: 'active',
          stale: false,
          lastActivityAt: at,
          nudgedAt: null,
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: offers.id });
      const record = await loadOffer(tx, inserted!.id);
      const notified = await announce(tx, record, false);
      return { record, notified, audience: await approvedMemberIds(tx) };
    });
    afterCommit(notified, audience);
    return record;
  }

  /**
   * PRD US-3.2: quantity down to what is held, date and note freely; any edit counts as
   * activity for the nudge cycle (US-3.4) and may re-publish the offer (ARCH §6).
   */
  async function edit(actor: Member, offerId: string, patch: EditOffer): Promise<OfferRecord> {
    const parsed = editOfferSchema.safeParse(patch);
    if (!parsed.success) throw validationFailed(parsed.error.flatten());
    const body = parsed.data;

    const { record, notified, audience } = await deps.db.transaction(async (tx) => {
      const at = now();
      const producer = await actorFrom(tx, actor, true);
      const before = await lockOffer(tx, offerId);
      assertProducer(before, producer);

      const quantity = body.quantity ?? parseQuantity(before.offer.quantity);
      const availableUntil =
        body.availableUntil === undefined ? before.offer.availableUntil : body.availableUntil;
      const note = body.note === undefined ? before.offer.note : body.note;

      if (body.quantity !== undefined) {
        assertStep(quantity, before.product);
        if (quantity < before.held) {
          throw new AppError('OFFER_QUANTITY_BELOW_HELD', {
            params: { held: before.held },
            details: { held: before.held },
          });
        }
      }
      if (body.availableUntil !== undefined) assertNotPast(availableUntil, at);

      const status = statusAfterEdit(availableUntil, today(at));
      if (status === 'active' && before.offer.status !== 'active') {
        await assertNoOtherActive(tx, producer.id, before.product.id, before.offer.id);
      }
      const after: OfferSnapshot = { status, quantity, held: before.held, availableUntil };
      const republished = isRepublish(snapshotOf(before), after, today(at));

      await tx
        .update(offers)
        .set({
          quantity: String(quantity),
          availableUntil,
          note,
          status,
          stale: false,
          nudgedAt: null,
          lastActivityAt: at,
          updatedAt: at,
        })
        .where(eq(offers.id, before.offer.id));
      const record = await loadOffer(tx, before.offer.id);
      const notified = republished ? await announce(tx, record, true) : 0;
      return { record, notified, audience: await approvedMemberIds(tx) };
    });
    afterCommit(notified, audience);
    return record;
  }

  /**
   * PRD US-3.2: withdraw hides the offer at once; open reservations stay valid and the
   * producer is reminded of them (N11). An expired offer may be withdrawn too, to tidy
   * *My offers*; a withdrawn one cannot be withdrawn again.
   */
  async function withdraw(actor: Member, offerId: string): Promise<OfferRecord> {
    const { record, notified, audience } = await deps.db.transaction(async (tx) => {
      const at = now();
      const producer = await actorFrom(tx, actor, true);
      const before = await lockOffer(tx, offerId);
      assertProducer(before, producer);
      if (before.offer.status === 'withdrawn') {
        throw invalidTransition({ action: 'withdraw', status: before.offer.status });
      }
      await tx
        .update(offers)
        .set({ status: 'withdrawn', updatedAt: at })
        .where(eq(offers.id, before.offer.id));
      const record = await loadOffer(tx, before.offer.id);

      let notified = 0;
      if (record.openReservations > 0) {
        const open = await tx
          .select({ quantity: reservations.quantity, requesterName: members.displayName })
          .from(reservations)
          .innerJoin(members, eq(members.id, reservations.requesterId))
          .where(
            and(
              eq(reservations.offerId, record.offer.id),
              inList(reservations.status, RESERVATION_HOLDING_STATUSES),
            ),
          )
          .orderBy(asc(reservations.createdAt));
        const row = await enqueueNotification(tx, {
          memberId: producer.id,
          kind: 'N11',
          payload: {
            offerId: record.offer.id,
            productName: record.product.name,
            productNameEs: record.product.nameEs,
            unitCode: record.product.unitCode,
            reservations: open.map((r) => ({
              requesterName: r.requesterName,
              quantity: parseQuantity(r.quantity),
            })),
          },
        });
        notified = row ? 1 : 0;
      }
      return { record, notified, audience: await approvedMemberIds(tx) };
    });
    afterCommit(notified, audience);
    return record;
  }

  /** PRD US-3.4 "Yes, still available": resets the nudge counter and clears the stale mark. */
  async function stillAvailable(actor: Member, offerId: string): Promise<OfferRecord> {
    const { record, audience } = await deps.db.transaction(async (tx) => {
      const at = now();
      const producer = await actorFrom(tx, actor, true);
      const before = await lockOffer(tx, offerId);
      assertProducer(before, producer);
      if (before.offer.status !== 'active') {
        throw invalidTransition({ action: 'still-available', status: before.offer.status });
      }
      await tx
        .update(offers)
        .set({ stale: false, nudgedAt: null, lastActivityAt: at, updatedAt: at })
        .where(eq(offers.id, before.offer.id));
      const record = await loadOffer(tx, before.offer.id);
      // The stale badge may have just gone; boards refetch only when it did.
      return { record, audience: before.offer.stale ? await approvedMemberIds(tx) : [] };
    });
    afterCommit(0, audience);
    return record;
  }

  /** ARCH §11 `GET /offers/mine`: active and expired offers; withdrawn ones are gone. */
  async function mine(actor: Member): Promise<OfferRecord[]> {
    return deps.db.transaction(async (tx) => {
      await actorFrom(tx, actor, false);
      const rows = await selectRecords(tx)
        .where(and(eq(offers.producerId, actor.id), ne(offers.status, 'withdrawn')))
        .orderBy(asc(offers.status), asc(products.name), desc(offers.createdAt));
      return rows.map(toRecord);
    });
  }

  /**
   * ARCH §11 `GET /offers/:id`, the target of the `o_<id>` deep link. Any member may look at
   * any offer, whatever its status, except those of a suspended producer (PRD US-1.4).
   */
  async function get(actor: Member, offerId: string): Promise<OfferRecord> {
    return deps.db.transaction(async (tx) => {
      await actorFrom(tx, actor, false);
      const record = await loadOffer(tx, offerId);
      if (record.producer.id !== actor.id && record.producer.status !== 'approved') {
        throw notFound({ offerId });
      }
      return record;
    });
  }

  /**
   * PRD US-3.3, ARCH §5 board query: other members' offers that are active, not past their
   * date, with something left, from approved producers. Search, category and grouping are
   * applied here so the Mini App shows what the API says.
   */
  async function board(actor: Member, query: BoardQuery): Promise<BoardResult> {
    return deps.db.transaction(async (tx) => {
      await actorFrom(tx, actor, false);
      const day = today(now());
      const rows = await selectRecords(tx).where(
        and(
          eq(offers.status, 'active'),
          eq(members.status, 'approved'),
          ne(offers.producerId, actor.id),
          or(isNull(offers.availableUntil), gte(offers.availableUntil, day)),
          sql`${offers.quantity} > ${heldSql}`,
        ),
      );
      const all = rows.map(toRecord).map(asEntry);
      const categories = [
        ...new Set(all.map((entry) => entry.product.category).filter((c): c is string => !!c)),
      ].sort((a, b) => a.localeCompare(b, 'ca'));
      const shown = all
        .filter((entry) => matchesSearch(entry, query.q))
        .filter((entry) => query.category === '' || entry.product.category === query.category)
        .sort(compareBoardEntries);
      return { groups: groupBoard(shown, query.group), categories, total: shown.length };
    });
  }

  /**
   * ARCH §9 `offers.expire` (PRD US-3.4): offers past their *available until* date become
   * `expired` at the start of the next day on the farm. Idempotent: a second run the same
   * night finds nothing active with a past date.
   */
  async function expire(at: Date): Promise<{ expired: number }> {
    const { expired, audience } = await deps.db.transaction(async (tx) => {
      const rows = await tx
        .update(offers)
        .set({ status: 'expired', updatedAt: at })
        .where(
          and(
            eq(offers.status, 'active'),
            isNotNull(offers.availableUntil),
            lt(offers.availableUntil, today(at)),
          ),
        )
        .returning({ id: offers.id });
      return { expired: rows.length, audience: rows.length ? await approvedMemberIds(tx) : [] };
    });
    afterCommit(0, audience);
    return { expired };
  }

  /**
   * ARCH §9 `offers.nudge` (PRD US-3.4), once a day at 09:00 on the farm. Among the dateless
   * offers that still have something to reserve, from approved producers:
   * - not nudged and idle for `offer_nudge_days` → N10 "still available?", `nudged_at` set;
   * - nudged, unanswered for `offer_stale_days_after_nudge` → marked stale (sorted last, badged);
   * - stale, last nudged a week ago → N10 again, weekly, until the producer answers.
   * An edit or *still available* clears `nudged_at` and `stale` (US-3.2, US-3.4), which is what
   * makes each step above run once per cycle however often the alarm fires.
   */
  async function nudge(at: Date): Promise<{ nudged: number; stale: number; renudged: number }> {
    const { report, notified, audience } = await deps.db.transaction(async (tx) => {
      const settings = await loadSettings(tx);
      const daysAgo = (days: number) => new Date(at.getTime() - days * 86_400_000);
      const idleSince = daysAgo(settings.offer_nudge_days);
      const unansweredSince = daysAgo(settings.offer_stale_days_after_nudge);
      const weekAgo = daysAgo(7);

      const rows = await selectRecords(tx)
        .where(
          and(
            eq(offers.status, 'active'),
            isNull(offers.availableUntil),
            eq(members.status, 'approved'),
            sql`${offers.quantity} > ${heldSql}`,
          ),
        )
        .for('update', { of: offers });
      const candidates = rows.map(toRecord);

      const toNudge = candidates.filter(
        (r) => r.offer.nudgedAt === null && r.offer.lastActivityAt <= idleSince,
      );
      const toMarkStale = candidates.filter(
        (r) => r.offer.nudgedAt !== null && !r.offer.stale && r.offer.nudgedAt <= unansweredSince,
      );
      const toRenudge = candidates.filter(
        (r) => r.offer.stale && r.offer.nudgedAt !== null && r.offer.nudgedAt <= weekAgo,
      );

      let notified = 0;
      for (const record of [...toNudge, ...toRenudge]) {
        await tx.update(offers).set({ nudgedAt: at }).where(eq(offers.id, record.offer.id));
        const row = await enqueueNotification(tx, {
          memberId: record.producer.id,
          kind: 'N10',
          payload: {
            offerId: record.offer.id,
            productName: record.product.name,
            productNameEs: record.product.nameEs,
            unitCode: record.product.unitCode,
            quantity: record.available,
          },
        });
        if (row) notified += 1;
      }
      for (const record of toMarkStale) {
        await tx.update(offers).set({ stale: true }).where(eq(offers.id, record.offer.id));
      }
      return {
        report: { nudged: toNudge.length, stale: toMarkStale.length, renudged: toRenudge.length },
        notified,
        // Only a new stale badge changes what a board shows.
        audience: toMarkStale.length ? await approvedMemberIds(tx) : [],
      };
    });
    afterCommit(notified, audience);
    return report;
  }

  return { publish, edit, withdraw, stillAvailable, mine, get, board, expire, nudge };
}
