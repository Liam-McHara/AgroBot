import { and, asc, desc, eq, gte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  messagesQuerySchema,
  postMessageSchema,
  RESERVATION_ACTIVE_STATUSES,
  RESERVATION_CLOSED_WINDOW_DAYS,
  type MessagesQuery,
  type PostMessage,
  type UnreadCounts,
} from '@agrobot/shared';
import type { Database, Executor, Transaction } from '../../db/client.js';
import {
  members,
  messages,
  notifications,
  reservations,
  threadReads,
  type Member,
  type Message,
} from '../../db/schema/index.js';
import { inList } from '../../db/schema/sql.js';
import { AppError, forbidden, notFound, validationFailed } from '../../errors.js';
import { assertMember } from '../members/service.js';
import { enqueueNotification } from '../notifications/outbox.js';
import { noopHub, type HubPort } from '../ports.js';
import { loadRecord, type ReservationRecord } from '../reservations/queries.js';
import { partyOf } from '../reservations/rules.js';
import { loadSettings } from '../settings/service.js';
import { chatDedupeKey, previewOf, threadWindowOf, type ThreadWindow } from './rules.js';

/**
 * Threads (PRD US-5.1; ARCH §5 `messages` and `thread_reads`, §7 `message.new`, §8 step 3,
 * §11; ADR-0005): one private conversation per reservation, between its two parties only.
 * Admins are not parties, so they cannot read a thread (PRD US-5.1).
 *
 * Posting writes the message and, in the same transaction, the one N9 of an unread burst
 * (ADR-0009): the `dedupe_key` `chat:<reservationId>:<memberId>` refuses a second row until the
 * recipient reads the thread, which clears the key; a recipient who has the thread open right
 * now (`hub.isViewing`) gets no row at all, the socket frame is enough. After the commit both
 * parties' sockets get `message.new`, and the hub is woken when a notification was written.
 */
export interface ThreadsDeps {
  db: Database;
  hub?: HubPort;
  now?: () => Date;
}

export type ThreadsService = ReturnType<typeof createThreadsService>;

export interface MessageRecord {
  message: Message;
  /** Who wrote it; `null` for a system line. */
  sender: { id: string; displayName: string } | null;
}

export interface ThreadPage {
  messages: MessageRecord[];
  hasMore: boolean;
}

/** PRD US-4.6: the member's unread text messages, in total, per side and per reservation. */
export interface UnreadSummary extends UnreadCounts {
  byReservation: ReadonlyMap<string, number>;
}

/** What `GET /reservations/:id` says about the thread: the viewer's unread and the window. */
export interface ThreadSummary extends ThreadWindow {
  unread: number;
}

const DAY_MS = 86_400_000;

/** The message a member's read marker points at; its `created_at` is where unread begins. */
const marker = alias(messages, 'marker');

export function createThreadsService(deps: ThreadsDeps) {
  const now = deps.now ?? (() => new Date());
  const hub = deps.hub ?? noopHub;

  /** The actor as the database has them right now (ARCH §4: never a stale in-memory copy). */
  async function actorFrom(tx: Transaction, actor: Member): Promise<Member> {
    const [fresh] = await tx.select().from(members).where(eq(members.id, actor.id)).for('share');
    if (!fresh) throw notFound();
    assertMember(fresh);
    return fresh;
  }

  /** The reservation, provided the actor is one of its parties; everyone else is refused. */
  async function partyRecord(
    tx: Transaction,
    member: Member,
    reservationId: string,
  ): Promise<{ record: ReservationRecord; party: 'requester' | 'producer' }> {
    const record = await loadRecord(tx, reservationId);
    const party = partyOf(record.reservation, member.id);
    if (!party) throw forbidden({ reason: 'not_party' });
    return { record, party };
  }

  /**
   * ARCH §5 `thread_reads`: the member has seen everything up to `lastMessageId`. Clearing the
   * throttle key is what lets the next burst notify again (ARCH §8 step 3).
   */
  async function markRead(
    tx: Transaction,
    reservationId: string,
    memberId: string,
    lastMessageId: string | null,
    at: Date,
  ): Promise<void> {
    await tx
      .insert(threadReads)
      .values({ reservationId, memberId, lastReadMessageId: lastMessageId, lastReadAt: at })
      .onConflictDoUpdate({
        target: [threadReads.reservationId, threadReads.memberId],
        set: { lastReadMessageId: lastMessageId, lastReadAt: at },
      });
    await tx
      .update(notifications)
      .set({ dedupeKey: null })
      .where(eq(notifications.dedupeKey, chatDedupeKey(reservationId, memberId)));
  }

  /**
   * PRD US-4.6: text messages from the counterpart after the member's read marker, per
   * reservation the member is a party of and would see in *My reservations* (active, or closed
   * in the last 30 days, so a badge never points at a row that is not listed). System lines
   * never count: N8 already told the member about the transition.
   */
  async function unreadRows(
    db: Executor,
    memberId: string,
    at: Date,
    reservationId?: string,
  ): Promise<Array<{ reservationId: string; producerId: string; count: number }>> {
    const since = new Date(at.getTime() - RESERVATION_CLOSED_WINDOW_DAYS * DAY_MS);
    return db
      .select({
        reservationId: reservations.id,
        producerId: reservations.producerId,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .innerJoin(reservations, eq(reservations.id, messages.reservationId))
      .leftJoin(
        threadReads,
        and(eq(threadReads.reservationId, reservations.id), eq(threadReads.memberId, memberId)),
      )
      .leftJoin(marker, eq(marker.id, threadReads.lastReadMessageId))
      .where(
        and(
          or(eq(reservations.requesterId, memberId), eq(reservations.producerId, memberId)),
          reservationId === undefined ? undefined : eq(reservations.id, reservationId),
          or(
            inList(reservations.status, RESERVATION_ACTIVE_STATUSES),
            gte(reservations.closedAt, since),
          ),
          eq(messages.kind, 'text'),
          ne(messages.senderId, memberId),
          sql`${messages.createdAt} > coalesce(${marker.createdAt}, ${threadReads.lastReadAt}, '-infinity'::timestamptz)`,
        ),
      )
      .groupBy(reservations.id, reservations.producerId);
  }

  function summarize(
    memberId: string,
    rows: Array<{ reservationId: string; producerId: string; count: number }>,
  ): UnreadSummary {
    const byReservation = new Map<string, number>();
    let incoming = 0;
    let outgoing = 0;
    for (const row of rows) {
      byReservation.set(row.reservationId, row.count);
      if (row.producerId === memberId) incoming += row.count;
      else outgoing += row.count;
    }
    return { total: incoming + outgoing, incoming, outgoing, byReservation };
  }

  /**
   * PRD US-5.1: post a text message. The thread must still be writable; the sender's own read
   * marker moves to the message (they have seen everything above it); the counterpart gets the
   * burst's N9 unless they are looking at the thread or have not read the previous one yet.
   */
  async function post(
    actor: Member,
    reservationId: string,
    input: PostMessage,
  ): Promise<MessageRecord> {
    const parsed = postMessageSchema.safeParse(input);
    if (!parsed.success) throw validationFailed(parsed.error.flatten());
    const body = parsed.data.body;

    const { record, notified, parties } = await deps.db.transaction(async (tx) => {
      const member = await actorFrom(tx, actor);
      // A share lock on the reservation row: a transition committing meanwhile is seen, and
      // the row itself is not changed here.
      await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.id, reservationId))
        .for('share');
      const { record: reservation, party } = await partyRecord(tx, member, reservationId);
      const recipient = party === 'producer' ? reservation.requester : reservation.producer;
      const settings = await loadSettings(tx);
      // Asked before the clock is read, so the message is stamped as late as possible and the
      // client's `after` cursor (ARCH §11) has the smallest window to miss it in.
      const viewing =
        recipient.status === 'approved' && (await hub.isViewing(recipient.id, reservationId));
      const at = now();
      const window = threadWindowOf(
        reservation.reservation,
        settings.thread_readonly_days_after_close,
        at,
      );
      if (!window.writable) {
        throw new AppError('THREAD_READONLY', {
          details: {
            closedAt: reservation.reservation.closedAt?.toISOString() ?? null,
            writableUntil: window.writableUntil?.toISOString() ?? null,
          },
        });
      }

      const [inserted] = await tx
        .insert(messages)
        .values({ reservationId, senderId: member.id, kind: 'text', body, createdAt: at })
        .returning();
      await markRead(tx, reservationId, member.id, inserted!.id, at);

      let notified = 0;
      // A suspended counterpart cannot open the thread (PRD §2); a ping would be a dead end.
      if (recipient.status === 'approved' && !viewing) {
        const row = await enqueueNotification(tx, {
          memberId: recipient.id,
          kind: 'N9',
          payload: {
            reservationId,
            senderName: member.displayName,
            productName: reservation.product.name,
            productNameEs: reservation.product.nameEs,
            unitCode: reservation.product.unitCode,
            quantity: reservation.quantity,
            preview: previewOf(body),
          },
          dedupeKey: chatDedupeKey(reservationId, recipient.id),
        });
        if (row) notified = 1;
      }
      return {
        record: {
          message: inserted!,
          sender: { id: member.id, displayName: member.displayName },
        },
        notified,
        parties: [reservation.requester.id, reservation.producer.id],
      };
    });
    if (notified > 0) hub.wake();
    hub.publish(parties, { type: 'message.new', reservationId });
    return record;
  }

  /**
   * ARCH §11 `GET /reservations/:id/messages?after=<id>&limit=`: the thread oldest first, in
   * pages, starting after a message the caller already holds.
   */
  async function list(
    actor: Member,
    reservationId: string,
    query: MessagesQuery,
  ): Promise<ThreadPage> {
    const parsed = messagesQuerySchema.safeParse(query);
    if (!parsed.success) throw validationFailed(parsed.error.flatten());
    const { after, limit } = parsed.data;

    return deps.db.transaction(async (tx) => {
      const member = await actorFrom(tx, actor);
      await partyRecord(tx, member, reservationId);
      let afterClause;
      if (after !== undefined) {
        const [cursor] = await tx
          .select({ id: messages.id, createdAt: messages.createdAt })
          .from(messages)
          .where(and(eq(messages.id, after), eq(messages.reservationId, reservationId)));
        if (!cursor) throw validationFailed({ after: 'unknown' });
        afterClause = sql`(${messages.createdAt}, ${messages.id}) > (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
      }
      const rows = await tx
        .select({
          message: messages,
          sender: { id: members.id, displayName: members.displayName },
        })
        .from(messages)
        .leftJoin(members, eq(members.id, messages.senderId))
        .where(and(eq(messages.reservationId, reservationId), afterClause))
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(limit + 1);
      return {
        messages: rows.slice(0, limit).map((row) => ({
          message: row.message,
          sender: row.sender && row.message.senderId !== null ? row.sender : null,
        })),
        hasMore: rows.length > limit,
      };
    });
  }

  /**
   * ARCH §11 `POST /reservations/:id/read`: everything in the thread counts as read, the N9
   * throttle re-arms, and the member's badges are returned as they now stand.
   */
  async function read(actor: Member, reservationId: string): Promise<UnreadSummary> {
    return deps.db.transaction(async (tx) => {
      const at = now();
      const member = await actorFrom(tx, actor);
      await partyRecord(tx, member, reservationId);
      const [latest] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.reservationId, reservationId))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(1);
      await markRead(tx, reservationId, member.id, latest?.id ?? null, at);
      return summarize(member.id, await unreadRows(tx, member.id, at));
    });
  }

  /** PRD US-4.6: the member's unread counts, for `GET /me` and the rows of *My reservations*. */
  async function unread(actor: Member): Promise<UnreadSummary> {
    return summarize(actor.id, await unreadRows(deps.db, actor.id, now()));
  }

  /** What the detail of one reservation says about its thread, for its party `actor`. */
  async function summary(actor: Member, record: ReservationRecord): Promise<ThreadSummary> {
    const at = now();
    const [settings, rows] = await Promise.all([
      loadSettings(deps.db),
      unreadRows(deps.db, actor.id, at, record.reservation.id),
    ]);
    return {
      ...threadWindowOf(record.reservation, settings.thread_readonly_days_after_close, at),
      unread: rows[0]?.count ?? 0,
    };
  }

  return { post, list, read, unread, summary };
}
