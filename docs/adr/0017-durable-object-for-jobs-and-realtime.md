# ADR-0017: One Durable Object for jobs and realtime; WebSocket replaces SSE

- Status: Accepted
- Date: 2026-09-18
- Supersedes the realtime half of [ADR-0009](0009-notification-outbox-and-sse.md); its
  transactional outbox stands unchanged.

## Context
[ADR-0016](0016-hosting-on-cloudflare-workers-and-neon.md) removes the always-on process. Two
parts of the design assumed it: the in-process scheduler (outbox dispatch every 2 s, reservation
jobs every 5 min, daily offer jobs, hourly sync) and the in-memory hub that was to push
Server-Sent Events to open Mini Apps. Workers are request-scoped. Cron Triggers exist (five on
the free plan) but tick on UTC minutes, and a five-minute tick that touches Postgres keeps Neon
awake all month. Realtime needs something that outlives a request and can be reached from any
request.

## Decision
One **Durable Object** class, `AgroBotHub`, one instance (`"hub"`), SQLite-backed, does both.

**Jobs.** The hub keeps a `schedule(job, due_at)` table in its own storage and one alarm set to
the earliest `due_at`. When the alarm fires it runs every job that is due, recomputes each job's
next `due_at`, and re-arms. Periodic jobs compute their next occurrence in Europe/Madrid (00:05
`offers.expire`, 09:00 `offers.nudge`, minute 7 of every hour `catalog.sync`). Deadline jobs
(`notifications.dispatch`, `reservations.remind`, `reservations.expire`) take their next `due_at`
from Postgres (`min(next_attempt_at)`, `min(expires_at − reminder)`, `min(expires_at)`) while the
database is already awake, and the Worker calls `hub.wake()` after any transaction that creates
or moves such a deadline, so the alarm is never later than the work. The outbox is drained in
batches of 20 (the free plan allows 50 subrequests per invocation), the hub re-arming itself at
once while rows remain, so a group-wide N3 to a hundred members takes five alarm runs and a few
seconds. One Cron Trigger every 15 minutes calls `hub.ensureArmed()` as a liveness check; it
reads only the hub's SQLite, never Postgres.

**Realtime.** The Mini App opens **one WebSocket** to `GET /api/events`, authenticated by a
short-lived ticket obtained from `POST /api/events/ticket` with the usual `tma` header (a browser
cannot set headers on a WebSocket, and `initData` does not belong in a URL). The Worker forwards
the upgrade to the hub, which accepts the socket with the **Hibernation API**, tagged by member
id, so an idle socket costs no duration. Domain services emit events after commit as before; the
Worker's subscriber calls `hub.publish(memberIds, event)` and the hub writes to the tagged
sockets. Event names and the "react by refetching" rule of ADR-0009 are unchanged. Presence for
the chat throttle is a socket message (`{viewing: reservationId | null}`) stored as the socket's
attachment; `hub.isViewing(memberId, reservationId)` answers the throttle check.

**Rate limits** (ARCH §17) are per-member counters in the hub's SQLite, checked before mutating
requests: one instance, so the count is exact.

## Consequences
- Everything that needs "a process" lives in one object with one storage and one alarm, which
  is also the one place to look when something does not run.
- The 2 s dispatcher and the 5 min sweeps are gone; nothing wakes Neon without work to do.
  Latency for the common case is unchanged: `hub.wake()` sets an alarm for *now*, which fires
  within about a second.
- Alarms are at-least-once and retried by the platform on failure. Every job was already
  idempotent (ADR-0004, ADR-0009), and the 15-minute heartbeat covers the one failure mode
  alarms have: a handler that forgets to re-arm.
- The Mini App's realtime store speaks WebSocket instead of `EventSource`; reconnect with
  backoff is ours to write, a dozen lines. Telegram's web views support WebSocket.
- The hub is a second place with code that touches Postgres (through the same Drizzle client and
  Hyperdrive binding) and has 30 s of CPU per run, which is where the catalogue sync and the
  fan-outs belong. Request handlers keep to one member's work within 10 ms.
- Testing: the hub's scheduling math, ticket store and socket registry get tests under
  `@cloudflare/vitest-pool-workers`; jobs keep their integration tests against Postgres by being
  plain functions the hub calls.
- One instance is also the ceiling. It is the same ceiling ADR-0002 accepted, for the same
  hundred members.

## Alternatives considered
- **Cron Triggers only.** Five per account on the free plan, minute granularity, UTC only (00:05
  in Madrid is 22:05 or 23:05 UTC depending on the season), and a five-minute tick that queries
  Postgres defeats Neon's autosuspend. Kept for the heartbeat, where it fits.
- **Cloudflare Queues** for notification dispatch (10 000 operations per day on the free plan).
  The `notifications` table already is the queue, with the retry state we want to inspect; a
  second queue duplicates it and spends a daily budget on it.
- **Polling from the Mini App.** No hub at all, but chat that feels slow and a request budget
  spent on empty answers.
- **SSE streamed from the hub.** Keeps `EventSource`, but an open stream keeps the object awake
  and bills duration: one hub awake all day is almost 11 000 of the 13 000 GB-s. WebSocket with
  hibernation costs nothing while idle.
- **Postgres `LISTEN/NOTIFY`.** Needs a long-lived connection, which neither a Worker nor
  Hyperdrive holds for us.
