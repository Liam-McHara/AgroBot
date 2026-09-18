# ADR-0009: Transactional notification outbox and SSE for realtime

- Status: Accepted. The SSE realtime transport is superseded by
  [ADR-0017](0017-durable-object-for-jobs-and-realtime.md) (2026-09-18); the transactional
  outbox stands.
- Date: 2026-09-17

## Context
1.0 re-sent a message to every user on every change, which is O(users) Telegram calls and
noisy. Notifications must not be lost when Telegram is slow or rate-limits us, and the Mini
App should update live while open without a socket server.

## Decision
- Domain services write **`notifications` rows in the same transaction** as the state change.
  An in-process dispatcher sends them to Telegram with retries and backoff, honouring
  `retry_after`. A `dedupe_key` implements per-thread chat throttling.
- Realtime to the Mini App uses **Server-Sent Events** from the same process; clients react to
  events by refetching, not by patching local state.

## Consequences
- No notification is lost on a crash between "state changed" and "message sent"; at-least-once
  delivery with idempotent quick actions.
- Rate limiting is centralized in one place.
- SSE works through Telegram's web view and needs no extra infrastructure; browsers reconnect
  automatically.
- The in-memory SSE hub assumes one instance ([ADR-0002](0002-single-node-service-postgres.md)).

## Alternatives considered
- **Send directly from the service.** Simplest, loses messages on failures, scatters rate
  limiting.
- **External queue (Redis, SQS).** More infrastructure than the scale justifies.
- **WebSockets.** Bidirectional not needed; SSE is simpler and proxies love it.
- **Client polling.** Acceptable fallback (pull to refresh exists) but poor for chat.
