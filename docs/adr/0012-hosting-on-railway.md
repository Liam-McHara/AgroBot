# ADR-0012: Host the service and Postgres on Railway

- Status: Superseded by [ADR-0016](0016-hosting-on-cloudflare-workers-and-neon.md) (2026-09-18)
- Date: 2026-09-17

## Context
ADR-0002 settles on one Node container plus a managed Postgres, which every serious PaaS can
run; PRD Q3 left the provider open with Fly.io + Neon as the placeholder default. AgroBot is
maintained by one or two people in their spare time for a single group of farmers, so the cost
that matters is attention, not the monthly bill: one dashboard, one CLI, one place where logs,
secrets, the database and the deploy live.

## Decision
Deploy to **Railway**: one service built from the repository `Dockerfile` (`railway.json`
committed), one Railway Postgres in the same project, secrets as service variables, the
service's Railway domain as `PUBLIC_URL` for the Telegram webhook. Daily managed backups,
verified once by the restore drill in M6.

## Consequences
- Database, service, variables, logs and metrics sit in one project; `DATABASE_URL` is wired by
  Railway rather than copied between two providers.
- No permanent free tier: expect a small fixed monthly cost. Accepted — it is roughly the price
  of the coffee that the group's admin meeting runs on.
- The app stays provider-agnostic: no Railway SDK, no Railway-only primitive, config only
  through the environment variables in ARCH §13. Moving is re-pointing a `Dockerfile`.
- Region is `europe-west`; Postgres and the service must share it or every query pays a
  transatlantic round trip against the PRD's 500 ms budget.
- We depend on Railway's backups. Until the restore drill passes, treat them as unproven.
- ADR-0002's passing mention of Fly.io + Neon was a placeholder, not a decision. It stands
  unedited and unsuperseded: its decision is one service plus a managed Postgres, and Railway
  is that. This ADR is where the provider is decided.

## Alternatives considered
- **Fly.io + Neon** (the PRD's placeholder). Generous free tiers and Neon branching is pleasant
  for migrations, but it is two providers, two CLIs and two failure modes for a service that is
  one container and one database.
- **Render.** Comparable, but the free tier spins the service down when idle, and a cold start
  in front of a Telegram webhook is exactly the latency the board is supposed to not have.
- **Own VPS with Docker Compose.** Cheapest and fully under our control, and it hands us OS
  updates, TLS renewal, backup scripts and monitoring — the work this project has the least of.
