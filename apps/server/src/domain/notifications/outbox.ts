import type { Executor } from '../../db/client.js';
import { notifications, type Notification } from '../../db/schema/index.js';
import type { ImplementedNotificationKind, NotificationPayloads } from './payloads.js';

/**
 * The enqueue side of the outbox (ARCH §8 step 1, ADR-0009).
 *
 * Callers pass the transaction that changes the state, so a crash between "state changed"
 * and "message sent" loses nothing: the row is committed with the change, and the dispatcher
 * job picks it up. `dedupeKey` is the per-thread chat throttle of PRD US-5.1; an enqueue that
 * collides with an existing key is skipped, not an error.
 */
export interface EnqueueInput<K extends ImplementedNotificationKind> {
  memberId: string;
  kind: K;
  payload: NotificationPayloads[K];
  dedupeKey?: string;
}

export async function enqueueNotification<K extends ImplementedNotificationKind>(
  db: Executor,
  input: EnqueueInput<K>,
): Promise<Notification | null> {
  const [row] = await db
    .insert(notifications)
    .values({
      memberId: input.memberId,
      kind: input.kind,
      payload: input.payload as unknown as Record<string, unknown>,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

/** One row per recipient, same kind and payload — how N1, N3 and N12 fan out. */
export async function enqueueNotifications<K extends ImplementedNotificationKind>(
  db: Executor,
  memberIds: readonly string[],
  kind: K,
  payload: NotificationPayloads[K],
): Promise<number> {
  if (memberIds.length === 0) return 0;
  const rows = await db
    .insert(notifications)
    .values(
      memberIds.map((memberId) => ({
        memberId,
        kind,
        payload: payload as unknown as Record<string, unknown>,
      })),
    )
    .returning({ id: notifications.id });
  return rows.length;
}
