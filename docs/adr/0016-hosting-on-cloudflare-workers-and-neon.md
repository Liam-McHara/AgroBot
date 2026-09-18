# ADR-0016: Host on Cloudflare Workers with Neon Postgres, on their free plans

- Status: Accepted
- Date: 2026-09-18
- Supersedes [ADR-0012](0012-hosting-on-railway.md). Supersedes the *always-on container* half
  of [ADR-0002](0002-single-node-service-postgres.md); its *one managed Postgres* half stands.

## Context
ADR-0012 chose Railway because attention, not money, was the scarce resource, and it accepted a
small monthly bill. That constraint has changed: AgroBot must run at **no cost**. Among the
platforms with a genuinely free tier in September 2026, only two can answer a Telegram webhook
without a cold start measured in minutes: Cloudflare Workers, and a virtual machine on Oracle's
Always Free tier. Every free tier is a set of daily caps, so the design must stay far under
them rather than merely fit.

The code as it stands assumes one always-on Node process: an in-process scheduler that polls
the outbox every two seconds, an in-memory realtime hub planned for M3, a bot in polling mode
in development, migrations on boot, and Node-only libraries (`googleapis`, `pino`,
`@hono/node-server`). It also leans on real Postgres: `SELECT … FOR UPDATE SKIP LOCKED`,
advisory locks, interactive transactions, `jsonb`, partial unique indexes, and 256 tests that
run against it.

## Decision
Run AgroBot as **one Cloudflare Worker** (Hono API, grammY webhook, Mini App as static assets)
plus **one Durable Object** for scheduled work and realtime
([ADR-0017](0017-durable-object-for-jobs-and-realtime.md)), with the database on **Neon's free
Postgres** reached through **Cloudflare Hyperdrive**. Everything on the Workers Free plan;
nothing on a paid plan.

Concretely:
- Postgres, Drizzle, the schema and the migrations stay. Neon is a real Postgres 16; nothing in
  `db/` or `domain/` changes for the move.
- The Node entry point, `@hono/node-server`, the `setTimeout` scheduler, the polling bot, the
  `Dockerfile` and `railway.json` are removed in M2.5. The runtime is workerd, in production and
  in development (`wrangler dev`).
- Fixed cadences (every 2 s, every 5 min) disappear. Work runs when it is due, from the Durable
  Object's alarm (ADR-0017), so the database is awake only when there is something to do.
- Migrations run from GitHub Actions on `main`, before `wrangler deploy`. The bot's webhook is
  registered by a script in the same workflow, not at boot; there is no boot.
- Backups are Neon's point-in-time restore: a six-hour window on the free plan, and nothing
  else. An off-site nightly dump was considered and deliberately not adopted; it is first in the
  backlog should the window ever feel short.
- The escape hatch is the **Workers Paid plan** ($5/month): the same code with 30 s of CPU per
  request and no daily caps. Not a different provider.

## Consequences
- Budgets the design must respect (Free plans, September 2026, per day unless stated): Workers
  100 000 requests and **10 ms CPU per request** (waiting on I/O does not count); Durable Objects
  100 000 requests, 13 000 GB-s, 30 s CPU per alarm; Hyperdrive 100 000 queries; Neon
  **100 CU-hours per month** (about 400 hours awake at 0.25 CU), 0.5 GB storage, autosuspend
  after 5 idle minutes and not configurable. Static assets and Workers Logs (200 000 events per
  day, 3 days retention) are free. At a hundred members this is at least an order of magnitude
  of headroom, provided **nothing polls Postgres on a timer**: a five-minute poll alone would
  keep Neon awake all month, about 180 CU-hours.
- Heavy work (the catalogue sync, notification fan-outs) runs in the Durable Object, which has
  30 s of CPU. A request handler has 10 ms and does one member's worth of work.
- The first request after five idle minutes waits for Neon to wake, roughly half a second to a
  second. PRD §12's latency budget excludes that wake-up. Telegram never notices; a member
  opening the Mini App after a quiet hour sees one slower first screen.
- Two vendors again, which ADR-0012 refused. The trade is explicit: Cloudflare has no Postgres,
  and its SQLite (D1) would cost the database layer and its tests. Hyperdrive makes Neon look
  like one more binding, and Neon is used for exactly one thing.
- Free tiers are caps, not quotas: past a cap the platform returns errors until midnight UTC.
  M6 adds a budget check to the runbook. The Paid plan is the answer if a cap is ever near.
- `googleapis` is replaced by a fetch-based Sheets client that signs its JWT with WebCrypto;
  `pino` by a JSON console logger that Workers Logs ingests. Both sit behind interfaces the code
  already has.
- Local development keeps Docker Postgres and one `.env`, which `wrangler dev` reads. The bot in
  development receives updates through a small forwarder that long-polls Telegram and posts each
  update to the local webhook, so the production code path is the only code path.
- Neon's six-hour restore window means a mistake noticed the next morning cannot be undone from
  a backup. Accepted knowingly for a dataset of this size and value; the nightly encrypted dump
  to R2 is one workflow file away (backlog item 1).
- Restarts are gone as a concept: a deploy is a new Worker version, sockets reconnect, alarms
  persist, Telegram retries. `wrangler rollback` undoes a bad deploy in seconds; migrations stay
  forward-only.

## Alternatives considered
- **Cloudflare Workers + D1 (SQLite).** One vendor, no wake-up, 30-day Time Travel restore. But
  D1 has no interactive transactions (only atomic batches), which would rewrite the reservation
  hold as a conditional statement, the schema from `pg-core` to `sqlite-core`, the migration,
  and the integration tests off Postgres. It discards most of the M0–M2 database work for a
  benefit (Time Travel) we judged smaller than the cost.
- **Oracle Cloud Always Free VM** running the current image, Postgres and Caddy under Docker
  Compose. Zero code change and always-on, but it is a server we would run: updates, backups,
  monitoring. Oracle reclaims free instances idle for seven days, which this workload would be,
  and halved the allowance in June 2026 without announcement. Free in money, expensive in the
  attention ADR-0012 was protecting.
- **Render or Koyeb free web services.** Both sleep (after 15 min and 1 h) and wake in about a
  minute; Render's free Postgres expires after 30 days. A quick action that answers a minute
  later is the latency ADR-0012 already refused.
- **Google Cloud Run + Neon.** Free at zero minimum instances, but 1–3 s cold starts, every open
  realtime connection keeps an instance billed, and it needs a billing account.
- **Fly.io, Cloudflare Containers.** No free tier since October 2024; Containers require the
  Paid plan. Both would run the current container almost unchanged, which is why they are the
  fallback if "free" is ever dropped as a requirement.
- **Supabase free Postgres** instead of Neon. Always-on, so no wake-up, but projects pause after
  seven quiet days, there are no backups on the free plan, and the restore story is worse than
  Neon's six hours.
- **Stay on Railway.** Roughly the price of a coffee a month, and the plan we had. Rejected by
  the new constraint, not on merit.
