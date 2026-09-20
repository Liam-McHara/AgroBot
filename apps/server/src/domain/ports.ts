import type { RealtimeEvent } from '@agrobot/shared';

/**
 * What the domain needs from the hub (ADR-0017), as a port so `domain/` never imports the
 * Durable Object or anything Cloudflare-specific (ARCH §2).
 *
 * `wake` and `publish` are fire-and-forget by design: they happen *after* a transaction has
 * committed and must never make a committed change look like a failure. The Worker
 * implementation runs them in `waitUntil`; tests pass a recorder or `noopHub`. `isViewing` is
 * the one question the domain asks the hub, and a hub that cannot answer counts as "no".
 */
export interface HubPort {
  /**
   * ARCH §8 step 2, §9: call after any commit that enqueued a notification or created or
   * moved a deadline, so the hub's next alarm is never later than the work.
   */
  wake(): void;
  /** ARCH §7: deliver an event to the open sockets of these members. */
  publish(memberIds: readonly string[], event: RealtimeEvent): void;
  /** ARCH §8 step 3: does this member have this thread open right now? (The N9 throttle.) */
  isViewing(memberId: string, reservationId: string): Promise<boolean>;
}

export const noopHub: HubPort = {
  wake() {},
  publish() {},
  async isViewing() {
    return false;
  },
};
