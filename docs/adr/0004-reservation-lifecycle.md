# ADR-0004: Reservation lifecycle: hold → confirm → deliver, with expiry

- Status: Accepted
- Date: 2026-09-17

## Context
In 1.0 an order was final on creation and nothing tracked whether it happened. Surplus is
perishable; a producer may be unable to honour a request; a requester may change their mind.
Two people must never count on the same crate.

## Decision
Reserving **holds** the quantity immediately (transactionally) and creates a **pending**
reservation. The **producer confirms or rejects**. Either party can **cancel** before delivery,
either can mark **delivered**. Pending reservations **expire** automatically after a
configurable time (default 48 h) with a reminder to the producer before that. Delivered
reservations deduct their quantity from the offer; every other terminal state releases the
hold.

## Consequences
- The board is always truthful: what it shows as available can be reserved.
- Every reservation ends; nothing needs manual cleanup.
- Six statuses and a handful of guards to implement and test; quick actions from Telegram must
  share the same guards as the API.
- Requires jobs (reminder, expiry) and settings for the durations.

## Alternatives considered
- **Reservation is binding, no confirmation.** Fewer states, but the producer has no way to say
  "sorry, it's gone" other than cancelling, and unanswered reservations never expire.
- **Reserve only, like 1.0.** No bookkeeping; the exact problem we are fixing.
- **Full handshake (both confirm delivery).** More taps for little gain in a trusted group.
