# Architecture Decision Records

Short records of decisions that shape AgroBot 2.0. One file per decision, numbered, never
edited after acceptance except to change the status (e.g. *Superseded by ADR-00xx*).

| # | Decision | Status |
|---|---|---|
| [0001](0001-telegram-bot-plus-mini-app.md) | Telegram bot + Telegram Mini App as the only client | Accepted |
| [0002](0002-single-node-service-postgres.md) | One Node service and a managed Postgres | Accepted; always-on container superseded by ADR-0016, managed Postgres stands |
| [0003](0003-google-sheet-catalog-source.md) | Google Sheet as catalogue source, members may propose products | Accepted |
| [0004](0004-reservation-lifecycle.md) | Reservation lifecycle: hold → confirm → deliver, with expiry | Accepted |
| [0005](0005-in-app-chat-per-reservation.md) | In-app chat per reservation, native DM as optional shortcut | Accepted |
| [0006](0006-stack-grammy-hono-drizzle-svelte.md) | Stack: pnpm monorepo, grammY, Hono, Drizzle, Svelte 5, Vitest, Playwright | Accepted |
| [0007](0007-i18n-catalan-spanish.md) | Catalan and Spanish from day one through one message catalogue | Accepted |
| [0008](0008-legacy-code-in-legacy-folder.md) | Keep 1.0 under `legacy/` until 2.0 ships, then delete | Accepted |
| [0009](0009-notification-outbox-and-sse.md) | Transactional notification outbox and SSE for realtime | Accepted; SSE superseded by ADR-0017, outbox stands |
| [0010](0010-auth-via-telegram-initdata.md) | Authentication via Telegram `initData`, no own accounts | Accepted |
| [0011](0011-defer-history-keep-snapshots.md) | Defer history/reporting but snapshot prices and keep records | Accepted |
| [0012](0012-hosting-on-railway.md) | Host the service and Postgres on Railway | Superseded by ADR-0016 |
| [0013](0013-reuse-the-1-0-bot-identity.md) | Reuse AgroBot 1.0's bot token and username | Accepted |
| [0014](0014-confirm-and-deliver-shortcut.md) | Confirm-and-deliver as one Mini App action | Accepted |
| [0015](0015-retain-merged-product-proposals.md) | Archive proposals resolved into an existing sheet product | Accepted |
| [0016](0016-hosting-on-cloudflare-workers-and-neon.md) | Host on Cloudflare Workers with Neon Postgres, on their free plans | Accepted |
| [0017](0017-durable-object-for-jobs-and-realtime.md) | One Durable Object for jobs and realtime; WebSocket replaces SSE | Accepted |

## Template

```markdown
# ADR-00NN: Title

- Status: Proposed | Accepted | Superseded by ADR-00MM
- Date: YYYY-MM-DD

## Context
What situation forces a decision, in two to five sentences.

## Decision
What we do.

## Consequences
What becomes easier, what becomes harder, what we now must do.

## Alternatives considered
Each one in a line or two, and why not.
```
