# CLAUDE.md — working in the AgroBot repository

AgroBot is a private tool for a group of farmers to share surplus produce: a Telegram bot plus
a Telegram Mini App backed by one Cloudflare Worker, one Durable Object and a Neon Postgres,
all on free plans (ADR-0016, ADR-0017). Version 2.0 is being built here from a written
specification; version 1.0 is frozen under `legacy/`. Since roadmap **M2.5** the code runs on
workerd, in production and in development (`wrangler dev`); there is no Node process.

## Start here, every session

1. Read `docs/README.md` (workflow), then the documents it lists, in that order. They are
   short and they are the source of truth.
2. Find the current milestone in `docs/roadmap.md` (first one with unchecked tasks) and read
   the PRD/architecture sections it cites under **Spec.** Read `apps/server/wrangler.jsonc`
   too: it is where the bindings, the cron and the assets live.
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
  (ADR-0017); after a commit that creates a deadline or a notification, call `hub.wake()`
  (the domain services receive the hub as a port). A fixed-interval sweep would keep the free
  database awake all month (ADR-0016).
- **A request handler does one member's work.** Fan-outs, the catalogue sync and anything else
  that grows with the group run in the hub (30 s of CPU) through `hub.runJob`, never in a
  request (10 ms).
- **Strict TypeScript, tests with the change.** Domain rules get unit tests; routes and jobs get
  integration tests against real Postgres; the hub gets tests under `@cloudflare/vitest-plugin`
  (`*.workers.test.ts`, run inside workerd); user flows get Playwright coverage per the roadmap.

## Repository layout

```
apps/server     Hono + grammY + Drizzle + jobs + the   packages/shared  zod contracts, enums, i18n
                AgroBotHub Durable Object; wrangler.jsonc docs/         the specification
apps/miniapp    Svelte 5 + Vite Telegram Mini App     legacy/          AgroBot 1.0, frozen
e2e/            Playwright suite against wrangler dev  .github/         CI + deploy on main/staging
scripts/        wrangler dev wrapper, Telegram forwarder, set-webhook, i18n check, Postgres init
```
Dependency rule: `miniapp` and `server` → `shared`. `domain/` inside the server imports no
HTTP, bot, hub or integration code (ESLint enforces it); it receives ports as parameters
(`domain/ports.ts` is the hub's). The server runs on workerd: no Node-only library in
`apps/server/src` (the `node:` modules workerd implements under `nodejs_compat` are fine);
`node:fs` and friends only in `db/migrate.ts`, `db/seed.ts`, `db/reset-test-database.ts`,
`dotenv.ts` and `scripts/`, which are Node CLIs. `src/worker.ts` is the entry;
`src/realtime/hub.ts` is the Durable Object; `src/jobs/index.ts` is the job table the hub runs.

## Commands

```bash
nvm use                              # Node 22.22.2+ (see .nvmrc)
pnpm install
docker compose up -d                 # Postgres 16 on 5432 (also creates agrobot_test)
cp .env.example .env                 # then fill BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET etc.
pnpm db:migrate && pnpm db:seed      # schema, then units, settings and dev members
pnpm dev                             # wrangler dev (Worker + hub, :8080) + Mini App (Vite, :5173)
                                     #   + the Telegram forwarder, all reading .env

pnpm lint                            # eslint + prettier --check + i18n catalogue check
pnpm typecheck                       # tsc across the workspace, svelte-check for the Mini App
pnpm test                            # unit + integration (needs Postgres) + hub tests in workerd
pnpm build                           # shared, Mini App, then `wrangler deploy --dry-run`
pnpm e2e                             # Playwright against wrangler dev on :8081 (run pnpm build first)

pnpm dev:telegram                    # the forwarder alone (deletes the throwaway bot's webhook,
                                     #   long-polls, POSTs updates to the local webhook)
pnpm bot:set-webhook                 # register PUBLIC_URL/telegram/webhook + the command menu
                                     #   (tunnels and production; stop the forwarder first)
pnpm deploy:worker [--env-file f]    # deploy from environment variables (CI does this);
                                     #   --dry-run validates without uploading
pnpm db:generate                     # new migration after editing src/db/schema
pnpm format                          # prettier --write
pnpm --filter @agrobot/server test:hub          # only the Durable Object tests
```

Integration tests use `TEST_DATABASE_URL` (default `…/agrobot_test`). Without a reachable
Postgres they skip with a warning locally and fail loudly in CI. The e2e suite (`e2e/`) needs
the same Postgres and a prior `pnpm build`; it resets that database, serves a CSV fixture and
boots `wrangler dev` on `:8081` with the dev auth bypass and a fresh hub state.

The server pins **Vitest 4** (the Cloudflare plugin requires it) while `shared` and the Mini App
are on Vitest 5; both run from `pnpm test`. `wrangler.jsonc` holds nothing deployment-specific
and is what `wrangler dev` runs; `pnpm deploy:worker` generates the git-ignored
`wrangler.deploy.jsonc` from environment variables (name, Hyperdrive id, placement, vars),
runs `wrangler deploy` with it and uploads the secrets (ARCH §13, §15). CI does that from
`main` (production) and `staging` (staging) with the GitHub Environment of the same name.

Catalogue development: configure `CATALOG_SOURCE=sheets` with the service-account variables,
or `CATALOG_SOURCE=csv` with `CATALOG_CSV_URL` (see README). Sync runs at minute 7 of every
hour from the hub, and once when the hub first exists after a deploy; admins can use `/sync`,
`/status`, or Admin → Catalogue → Sync now, which run the job inside the hub.
Focused catalogue integration checks: `pnpm --filter @agrobot/server exec vitest run test/catalog.test.ts`.
They use fixture sources; no Google credentials or real Telegram bot are needed.

Offers and the board: `domain/offers` owns publish, edit, withdraw, still-available, the board
query and the two daily jobs (`offers.expire` at 00:05, `offers.nudge` at 09:00, Europe/Madrid).
Focused checks: `pnpm --filter @agrobot/server exec vitest run test/offers.test.ts
test/offers-api.test.ts test/offers-jobs.test.ts` (the last one drives the jobs with a fake
clock). The e2e suite runs a fake Telegram Bot API (`e2e/start-server.mjs`, `TELEGRAM_API_ROOT`)
and reads what the hub dispatched at `GET /messages`, which is how a notification is asserted
end to end; the variable is refused in production. A spec can also play Telegram: POST a
`callback_query` update to `/telegram/webhook` with the e2e secret header to tap a quick action.

Reservations: `domain/reservations` owns create (offer row locked, then `held` read in a second
statement), the five actions of ARCH §6 (`confirm-and-deliver` is the Mini App's, never a quick
action), the list, the two deadline jobs (`reservations.remind`, `reservations.expire`, due when
Postgres says so; `hub.wake()` makes every deadline job due) and the catalogue cascade
(`cascade.ts`: price snapshots on resolution, cancellations on rejection). Row locks go
reservation first, then offer. Focused checks: `pnpm --filter @agrobot/server exec vitest run
test/reservations.test.ts test/reservations-api.test.ts test/reservations-jobs.test.ts`.

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
thread · message · notification · quick action · catalogue sync · pending product · stale offer ·
nudge (the "still available?" N10) · re-publish (an edit that puts an offer back on the board) ·
hub (the Durable Object) · job · wake (make the dispatcher due now) · ticket (socket handshake).
Definitions in `docs/prd.md` §3.
