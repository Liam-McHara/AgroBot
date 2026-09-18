# CLAUDE.md — working in the AgroBot repository

AgroBot is a private tool for a group of farmers to share surplus produce: a Telegram bot plus
a Telegram Mini App backed by one Cloudflare Worker, one Durable Object and a Neon Postgres,
all on free plans (ADR-0016, ADR-0017). Version 2.0 is being built here from a written
specification; version 1.0 is frozen under `legacy/`. Until roadmap **M2.5** lands, the code
still runs as one Node process; M2.5 is the milestone that moves it.

## Start here, every session

1. Read `docs/README.md` (workflow), then the documents it lists, in that order. They are
   short and they are the source of truth.
2. Find the current milestone in `docs/roadmap.md` (first one with unchecked tasks) and read
   the PRD/architecture sections it cites under **Spec.**
3. Only then write code.

## Non-negotiables

- **Spec first.** No behaviour that is not in `docs/prd.md`. If you must deviate, edit the spec
  in the same change and say so. Decisions with rejected alternatives get an ADR
  (`docs/adr/`, template in its README); existing ADRs are never edited, only superseded.
- **`legacy/` is read-only.** Never import from it, extend it, or include it in tooling.
- **Both languages or neither.** Every user-facing string exists in `ca` and `es` in
  `packages/shared/src/messages/`. Never hard-code UI text in code.
- **Quantities change inside transactions.** Reservation creation locks the offer row.
  Availability is derived, never stored.
- **Notifications go through the outbox** (`notifications` table), never straight to the
  Telegram API from domain code.
- **Authorization lives in domain services**, so API routes and bot quick actions share it.
- **Nothing polls Postgres on a timer.** Jobs run from the hub's alarm when something is due
  (ADR-0017); after a commit that creates a deadline or a notification, call `hub.wake()`. A
  fixed-interval sweep would keep the free database awake all month (ADR-0016).
- **A request handler does one member's work.** Fan-outs, the catalogue sync and anything else
  that grows with the group run in the hub (30 s of CPU), never in a request (10 ms).
- **Strict TypeScript, tests with the change.** Domain rules get unit tests; routes and jobs get
  integration tests against real Postgres; the hub gets tests under
  `@cloudflare/vitest-pool-workers`; user flows get Playwright coverage per the roadmap.

## Repository layout (target; created in M0)

```
apps/server     Hono + grammY + Drizzle + jobs + the   packages/shared  zod contracts, enums, i18n
                AgroBotHub Durable Object; wrangler.jsonc docs/         the specification
apps/miniapp    Svelte 5 + Vite Telegram Mini App     legacy/          AgroBot 1.0, frozen
e2e/            Playwright suite against wrangler dev  .github/         CI + deploy on main
```
Dependency rule: `miniapp` and `server` → `shared`. `domain/` inside the server imports no
HTTP, bot, hub or integration code. From M2.5 the server runs on workerd: no Node-only
library in `apps/server/src` (the `node:` modules workerd implements are fine); `node:fs` and
friends only in `db/migrate.ts`, `db/seed.ts` and `scripts/`.

## Commands

```bash
nvm use                              # Node 22.22.2+ (see .nvmrc)
pnpm install
docker compose up -d                 # Postgres 16 on 5432 (also creates agrobot_test)
cp .env.example .env                 # then fill BOT_TOKEN etc.
pnpm db:migrate && pnpm db:seed      # schema, then units, settings and dev members
pnpm dev                             # server (polling bot, :8080) + Mini App (:5173)

pnpm lint                            # eslint + prettier --check + i18n catalogue check
pnpm typecheck                       # tsc across the workspace, svelte-check for the Mini App
pnpm test                            # unit + integration (integration needs Postgres)
pnpm build                           # shared, Mini App, server
pnpm e2e                             # Playwright membership + catalogue (run pnpm build first)

pnpm db:generate                     # new migration after editing src/db/schema
pnpm format                          # prettier --write
```

Integration tests use `TEST_DATABASE_URL` (default `…/agrobot_test`). Without a reachable
Postgres they skip with a warning locally and fail loudly in CI. The e2e suite (`e2e/`) needs
the same Postgres and a prior `pnpm build`; it boots the built server on `:8081` with the dev
auth bypass and a reset database.

The command names above survive M2.5; their internals change (ARCH §14–§15): `pnpm dev` runs
`wrangler dev --port 8080`, Vite and the Telegram forwarder; `pnpm build` validates the Worker
bundle with `wrangler deploy --dry-run`; `pnpm e2e` boots `wrangler dev`; and two scripts are
added, `pnpm bot:set-webhook` and `pnpm dev:telegram`. Update this section in the M2.5 PR.

Catalogue development: configure `CATALOG_SOURCE=sheets` with the service-account variables,
or `CATALOG_SOURCE=csv` with `CATALOG_CSV_URL` (see README). Sync runs hourly and once on boot
if never attempted; admins can use `/sync`, `/status`, or Admin → Catalogue → Sync now.
Focused catalogue integration checks: `pnpm --filter @agrobot/server exec vitest run test/catalog.test.ts`.
They use fixture sources; no Google credentials or real Telegram bot are needed.

## Git

- Branch per milestone or task (`m0-foundation`, `m3-board-search`).
- **Commits follow [Conventional Commits](https://www.conventionalcommits.org) 1.0.0:**
  `<type>(<scope>): <subject>`, imperative and lower-case, no trailing period, ≤72 characters.
- Types: `feat` · `fix` · `docs` · `refactor` · `test` · `build` · `ci` · `chore` · `perf` ·
  `style` · `revert`. Anything user-visible is `feat` or `fix`; spec edits are `docs`.
- Scopes are the workspace or area touched: `server`, `miniapp`, `shared`, `db`, `bot`, `api`,
  `domain`, `jobs`, `hub`, `i18n`, `docs`, `ci`, `deploy`. Omit the scope only for repo-wide
  changes.
- Body (wrapped at ~100 columns) explains **why**, not what. Reference `US-x.y` / `N<n>` /
  `ADR-00NN` there, and close roadmap tasks with a `Refs:` footer.
- Breaking changes: `!` after the scope **and** a `BREAKING CHANGE:` footer explaining the
  migration — API contracts, message keys, and DB schema all count.
- Small commits: one logical change each, tests in the same commit as the code they cover.
- PR titles use the same format; a PR that completes roadmap tasks checks their boxes in
  `docs/roadmap.md`.

```
feat(domain): derive offer availability from confirmed reservations

Storing `available` drifted whenever a reservation expired outside the request that
created it. Deriving it inside the locking transaction keeps the two in step.

Refs: US-2.3, ADR-0004
```

- Never force-push shared branches. Never commit `.env` or service-account keys.

## Domain vocabulary (use these words, in English, in code)

member · applicant · admin · product · unit · offer · available · held · reservation
(pending, confirmed, delivered, rejected, cancelled, expired) · requester · producer ·
thread · message · notification · quick action · catalogue sync · pending product · stale offer.
Definitions in `docs/prd.md` §3.
