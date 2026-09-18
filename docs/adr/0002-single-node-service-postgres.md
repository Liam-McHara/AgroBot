# ADR-0002: One Node service and a managed Postgres

- Status: Accepted. The *single always-on container* is superseded by
  [ADR-0016](0016-hosting-on-cloudflare-workers-and-neon.md) (2026-09-18); the *one managed
  Postgres* stands.
- Date: 2026-09-17

## Context
Target scale is about a hundred members. 1.0 mixed a long-polling process with an unfinished
serverless webhook and kept wizard state in memory, which broke on restarts. We need realtime
(SSE) for chat, scheduled jobs, and relational integrity for quantities held by reservations.

## Decision
A **single always-on container** running one Node process (HTTP API, bot webhook, static Mini
App, in-process jobs, SSE hub) backed by a **managed Postgres**. Default hosting Fly.io +
Neon; any container host works.

## Consequences
- Trivial operations: one image, one database, one set of env vars, migrations on boot.
- SSE and jobs are easy because there is exactly one instance. Scaling out would require moving
  the SSE fan-out to Postgres `LISTEN/NOTIFY` and adding job leases; the code isolates both
  behind small interfaces so this is possible later, but not planned.
- Transactions with row locks give correct availability under concurrent reservations.
- Brief downtime on deploys is acceptable; Telegram retries webhook deliveries.

## Alternatives considered
- **Serverless functions.** Cheap, but SSE is awkward, jobs need the provider's scheduler, and
  cold starts hurt the bot's responsiveness.
- **Supabase-centric.** Less backend code, but bridging Telegram identity into Supabase Auth
  and expressing the reservation rules in RLS/edge functions is more complex than owning a
  small server.
- **Keep MongoDB.** Availability math and status queries are relational; Postgres constraints
  (partial unique index for one active offer per product, numeric types) remove a class of bugs.
