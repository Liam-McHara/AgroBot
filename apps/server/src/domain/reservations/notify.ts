import type { Transaction } from '../../db/client.js';
import { messages } from '../../db/schema/index.js';
import { enqueueNotification } from '../notifications/outbox.js';
import type { ReservationDecision, ReservationPayload } from '../notifications/payloads.js';
import type { ReservationRecord } from './queries.js';
import { type Party, type SystemLineMeta } from './rules.js';

/**
 * The side effects every reservation transition shares (ARCH §6): the system line in the
 * thread and the outbox rows, written in the same transaction as the state change (ADR-0009).
 */

export function reservationPayload(record: ReservationRecord): ReservationPayload {
  return {
    reservationId: record.reservation.id,
    offerId: record.offer.id,
    productName: record.product.name,
    productNameEs: record.product.nameEs,
    unitCode: record.product.unitCode,
    quantity: record.quantity,
    unitPriceCents: record.reservation.unitPriceCents,
    requesterName: record.requester.displayName,
    producerName: record.producer.displayName,
  };
}

/** ARCH §5 `messages`, kind `system`: the body is the event code; M5 renders `meta`. */
export async function writeSystemLine(
  tx: Transaction,
  reservationId: string,
  meta: SystemLineMeta,
  at: Date,
): Promise<void> {
  await tx.insert(messages).values({
    reservationId,
    senderId: null,
    kind: 'system',
    body: meta.event,
    meta: { ...meta },
    createdAt: at,
  });
}

export interface ClosedNotice {
  decision: ReservationDecision;
  actorName: string | null;
  reason: string | null;
  cause: 'product_rejected' | null;
  recipients: readonly Party[];
}

/** PRD N8 to the given parties; returns how many rows were written. */
export async function notifyClosed(
  tx: Transaction,
  record: ReservationRecord,
  notice: ClosedNotice,
): Promise<number> {
  let written = 0;
  for (const recipient of notice.recipients) {
    const member = recipient === 'producer' ? record.producer : record.requester;
    const row = await enqueueNotification(tx, {
      memberId: member.id,
      kind: 'N8',
      payload: {
        ...reservationPayload(record),
        decision: notice.decision,
        recipient,
        actorName: notice.actorName,
        reason: notice.reason,
        cause: notice.cause,
      },
    });
    if (row) written += 1;
  }
  return written;
}
