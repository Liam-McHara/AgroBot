# AgroBot 2.0 — Roadmap

_The implementation plan. Each milestone is sized for one to three focused Claude Code
sessions, has a definition of done that can be checked, and references the requirements it
implements. Work milestones in order; inside a milestone the tasks are roughly ordered too._

Legend: **PRD** → [prd.md](prd.md), **ARCH** → [architecture.md](architecture.md),
**ADR** → [adr/](adr/README.md). Check boxes are updated in the PR that completes the task.

## Overview

| Milestone | Outcome | Depends on |
|---|---|---|
| [M0 Foundation](#m0--foundation) | Empty but complete workspace: tooling, DB, CI, container, dev loop. | — |
| [M1 Identity and membership](#m1--identity-and-membership) | `/start`, approval flow, Mini App shell with gate, i18n, settings. | M0 |
| [M2 Catalogue](#m2--catalogue) | Sheet sync, units, products, proposals, admin catalogue screen. | M1 |
| [M2.5 Free hosting](#m25--free-hosting-cloudflare-workers-durable-object-neon) | The same app on Cloudflare Workers + one Durable Object + Neon, all free; no always-on process left. | M2 |
| [M3 Offers and board](#m3--offers-and-board) | Publish/edit/withdraw, board, new-offer notifications, expiry and nudges. | M2.5 |
| [M4 Reservations](#m4--reservations) | Full lifecycle with jobs, notifications, quick actions, screens. | M3 |
| [M5 Chat](#m5--chat) | Threads, live messages, unread, throttled notifications, native DM link. | M4 |
| [M6 Admin, hardening, launch](#m6--admin-hardening-launch) | Admin members/settings, rate limits, e2e, docs, production, pilot. | M5 |
| [Post-2.0 backlog](#post-20-backlog) | Deferred items, in the order we expect to want them. | 2.0 live |

Estimated effort is deliberately not given per task; the milestone ordering and definitions of
done are the commitment. M2.5 was inserted on 2026-09-18 when hosting moved to free plans
(ADR-0016); M3–M6 keep their numbers because accepted ADRs reference them.

---

## M0 — Foundation

**Goal.** A developer (or a fresh Claude Code session) can clone, run `pnpm dev`, get a
running server with a migrated database and a blank Mini App, and CI is green.

**Spec.** ARCH §2, §3, §13–§16 · ADR-0002, 0006, 0008, 0012 (Railway, since superseded by
0016), 0013 (bot identity).

**Tasks**
- [x] Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` (strict), ESLint flat
      config (ts + svelte), Prettier, `.editorconfig`, `.nvmrc`/`engines` (Node 22).
- [x] `packages/shared`: skeleton with `enums.ts` (all statuses, unit codes, error codes,
      notification kinds from PRD/ARCH), `messages/ca.json` + `es.json` with the first keys,
      `t()` helper with plural/number/date support and unit tests, i18n parity check script.
- [x] `apps/server`: Hono app with `/health`, pino logging + request ids, `env.ts` (zod),
      Drizzle client, schema for **all tables in ARCH §5** and the initial migration, seed
      script (units, default settings, dev members), `migrate` and `seed` scripts, graceful
      shutdown.
- [x] `apps/server`: grammY bot wired for both `polling` and `webhook` modes; `/start` replies
      with a placeholder in the user's language; webhook registered on boot with secret.
- [x] `apps/miniapp`: Svelte 5 + Vite, Telegram SDK init, theme variables, router with a single
      "Hello, {name}" screen calling `GET /api/me`; `tma` auth header; dev auth bypass.
- [x] `docker-compose.yml` (Postgres 16), `.env.example` documenting every variable of ARCH §13.
- [x] `Dockerfile` multi-stage; `railway.json` (ADR-0012); migrations on boot. _Replaced in
      M2.5 by `wrangler.jsonc` and migrations from CI (ADR-0016); `railway.json` is already gone._
- [x] `.github/workflows/ci.yml`: lint, typecheck, unit, integration (Postgres service), build.
- [x] Update `CLAUDE.md` with the real commands; README "Getting started" section.
- [x] Exclude `legacy/` from every tool (tsconfig, eslint, vitest, prettier).

**Definition of done**
- `pnpm install && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` works
  from a clean clone following only the README.
- `pnpm lint typecheck test build` passes locally and in CI on the PR.
- The container builds and serves `/health` and the Mini App placeholder.
- The bot answers `/start` in `ca` and `es` in polling mode.

---

## M1 — Identity and membership

**Goal.** Only approved farmers get in; admins approve from Telegram or the Mini App; every
screen speaks the member's language.

**Spec.** PRD §2, §5, US-1.1–1.5, N1–N2 · ARCH §4, §8 (outbox), §12 gate · ADR-0010.

**Tasks**
- [x] `domain/members`: apply (create applicant), auto-approve (invites, `ADMIN_TELEGRAM_IDS`),
      approve/reject/suspend/reinstate/promote/demote with last-admin guard; unit tests.
- [x] `initData` validation middleware with constant-time compare, `auth_date` window, member
      upsert, `requireMember`/`requireAdmin`; integration tests incl. tampered hash.
- [x] Notification outbox: table already exists; implement enqueue port, dispatcher job with
      backoff and `retry_after`, renderer registry keyed by `kind`; N1 and N2 renderers with
      quick actions; integration test with a fake Telegram API.
- [x] Bot: `/start` full behaviour (applicant, repeat, pre-approved, admin bootstrap, member with
      *Open AgroBot* button); quick actions `approve:<id>` / `reject:<id>` editing the original
      message; `/help`.
- [x] API: `GET/PATCH /me`, `GET /admin/members`, member actions, `GET/POST/DELETE /admin/invites`.
- [x] Mini App: gate screen (applicant / rejected / suspended), bottom navigation shell,
      Settings (language, display name), Admin → Members (applicants, members, invites).
- [x] i18n: all strings of this milestone in `ca` and `es`; language switch re-renders
      instantly; notifications use recipient language.

**Definition of done**
- A stranger pressing `/start` sees "waiting"; admins get N1 with buttons; approving from the
  button or from the Mini App unlocks the app for them and sends N2.
- Suspended member sees the suspended screen and every other API call returns 403.
- Cannot demote or suspend the last admin (tested).
- E2E (Playwright, dev bypass): applicant → admin approves → applicant sees the board shell.

---

## M2 — Catalogue

**Goal.** Products, units and prices come from the group's sheet; farmers can propose missing
products; admins see sync health.

**Spec.** PRD §6, US-2.1–2.2, N4, N5, N12 · ARCH §10, §11 (products, admin/catalog) · ADR-0003, 0015.

**Tasks**
- [x] `integrations/google-sheets.ts` (service account) and `csv-catalog.ts` behind one
      `CatalogSource` interface; header alias normalization (ca/es/en); row parser with zod,
      unit mapping, price parsing (`,`/`.`); unit tests with fixture sheets incl. broken rows.
- [x] `domain/catalog`: `applyDiff` in one transaction (upsert by slug, archive missing,
      un-archive, resolve pending by slug, price-resolve open reservations — the last one is a
      no-op until M4 but the hook exists), content-hash short-circuit, zero-valid-rows guard,
      `catalog_syncs` logging; integration tests.
- [x] Job `catalog.sync` hourly + on boot if never synced; admin `POST /admin/catalog/sync`;
      bot `/sync` (admin only) and `/status`.
- [x] Proposals: `POST /products/proposals`, N4 to admins with the exact name; admin
      `rename` / `reject` (reject cascades are stubs until offers exist in M3, then completed).
- [x] API `GET /products` (search, includes my pending), `GET /admin/catalog`.
- [x] Mini App: product picker component (search, "Propose «…»" with unit choice), Admin →
      Catalogue (last sync, errors table, product list with status filters, pending products
      with rename/reject and copy-to-clipboard name, link to the sheet).
- [x] N12 on failed sync.

**Definition of done**
- Pointing the app at a test sheet imports it; editing a price and re-syncing updates it; deleting
  a row archives the product; a row with an unknown unit is reported by row number and the
  rest is applied; an empty sheet is rejected and admins notified.
- A member proposes "tomàquet cor de bou", admins are notified, adding the row to the sheet
  resolves it on the next sync (integration test with the CSV source).

**Verified in M2:** CSV integration against real Postgres and a built-app Playwright flow
cover both acceptance scenarios. The Sheets adapter is tested with a mocked API; live Google
access uses deployment credentials. `pnpm lint`, `pnpm typecheck`, `pnpm test` (256 tests) and
`pnpm build` pass; `pnpm e2e` passes all four flows, including M1 regressions.

---

## M2.5 — Free hosting: Cloudflare Workers, Durable Object, Neon

**Goal.** The same application runs on the Workers Free plan and Neon's free Postgres, with no
always-on process left in the code, and the dev loop, CI and e2e run against the real runtime
(`wrangler dev`). Nothing user-visible changes.

**Spec.** ARCH §1–§3, §7–§9, §13–§17 · PRD §12 · ADR-0016 (hosting), ADR-0017 (hub).

**Tasks**
- [ ] Accounts: Neon project (Frankfurt, `aws-eu-central-1`) with `production` and `staging`
      branches; a Hyperdrive configuration per branch pointing at the pooled connection string;
      the GitHub Environments `staging` and `production` with the deployment's variables and
      secrets (the deploy script uploads the Worker secrets from them). _Manual, needs the
      owner's Cloudflare and Neon accounts; the steps are README "First-time setup". Nothing in
      the repository changes for it._
- [x] `apps/server/wrangler.jsonc` with the assets, Hyperdrive and Durable Object bindings, the
      `nodejs_compat` flag, targeted placement in the database's region, `observability.enabled`
      and the 15-minute heartbeat cron, and nothing deployment-specific: `pnpm deploy:worker`
      generates the deploy configuration (name, Hyperdrive id, placement, vars) from environment
      variables and uploads the secrets, so another group can clone the repository and run its
      own AgroBot without editing a tracked file.
- [x] Worker entry `src/worker.ts`: `fetch` builds the deps per request (env from bindings, a
      postgres.js client on `env.HYPERDRIVE.connectionString` closed in `waitUntil`) and mounts
      the Hono app; `env.ts` takes a bindings object and loses `BOT_MODE`, `PORT`, `LOG_PRETTY`;
      the Mini App is served by Static Assets (`single-page-application`, `run_worker_first` for
      `/api/*`, `/telegram/*`, `/health`), so `app.ts` loses `serveStatic` and the SPA fallback.
- [x] `realtime/hub.ts`: Durable Object `AgroBotHub` (SQLite) with the `schedule(job, due_at)`
      table and a single alarm; `wake()`, `ensureArmed()`, `runJob(name)`; next-occurrence math
      in Europe/Madrid for periodic jobs (`jobs/schedule.ts`); deadline lookups for
      dispatch/remind/expire (`jobs/deadlines.ts`); tests under `@cloudflare/vitest-plugin` with
      a fake clock, and unit tests of the math on both DST days.
- [x] Jobs on the hub: `notifications.dispatch` in batches of 20, immediate re-arm while rows
      remain, retries at `next_attempt_at`; `catalog.sync` hourly and on demand (`/sync` and
      `POST /admin/catalog/sync` await `hub.runJob`); `jobs/scheduler.ts` deleted. Domain code
      calls `hub.wake()` after commits that enqueue; integration tests keep calling the job
      functions directly.
- [x] WebSocket hub: `POST /api/events/ticket` (random, single-use, 30 s, stored in the hub),
      `GET /api/events?ticket=` upgrade with `Origin` check forwarded to the hub, Hibernation
      API with member tags, `publish(memberIds, event)`, `isViewing`, per-member rate counters.
      Mini App realtime store (one `WebSocket`, reconnect with backoff, `{viewing}` messages)
      behind the same `refetch()` interface; `me.changed` on `PATCH /me` proves the path end to
      end (Playwright, two contexts).
- [x] Replace `googleapis` with `integrations/google-sheets.ts` on `fetch` + WebCrypto (RS256
      JWT → access token → `values.get`), same `CatalogSource` interface, tests with a mocked
      `fetch` that verifies the signature. Replace `pino` with the JSON console logger behind
      the existing `Logger` type.
- [x] Remove the Node runtime: `src/index.ts`, `@hono/node-server`, polling mode, `Dockerfile`,
      `.dockerignore`. Keep `tsx` and `drizzle-kit` for `db:migrate`, `db:seed`, `db:generate`
      and the scripts, which stay Node CLIs.
- [x] Dev loop: `pnpm dev` = `wrangler dev --port 8080` + `vite` + `scripts/dev-telegram.mjs`
      (deletes the throwaway bot's webhook, long-polls `getUpdates`, POSTs each update to the
      local webhook with the secret header); `scripts/set-webhook.mjs` as `pnpm bot:set-webhook`
      for tunnels and production. One `.env`, read by wrangler, Vite and the scripts.
- [x] CI: `wrangler deploy --dry-run` inside `pnpm build`; e2e boots `wrangler dev` (local
      Hyperdrive → `agrobot_test`) instead of `node dist/index.js`; a `deploy` job on `main`
      (and `staging`) after the checks runs `pnpm db:migrate` against Neon, `pnpm deploy:worker`,
      then `pnpm bot:set-webhook`, all from the GitHub Environment of the same name: variables
      for the plain values (`WORKER_NAME`, `HYPERDRIVE_ID`, `PUBLIC_URL`, `BOT_USERNAME`, …) and
      secrets for `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`, `BOT_TOKEN`,
      `TELEGRAM_WEBHOOK_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `SENTRY_DSN`.
- [ ] First deploy to the **staging** Worker with a throwaway bot and the Neon `staging`
      branch: `/start`, approval from a quick action, a catalogue sync from a test sheet, one
      realtime event, and the Neon console showing compute suspended between interactions.
      _Blocked on the accounts task above; push to `staging` once it is done._
- [x] Docs brought in line with what shipped: README getting started and deployment, CLAUDE.md
      commands, ARCH §2–§4, §7, §9, §11, §13–§16; ADR-0016 and ADR-0017's consequences
      checked against the code and found to hold, so no new ADR.

**Definition of done**
- `pnpm install && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` from a
  clean clone following only the README: Mini App at `:5173`, Worker at `:8080`, `/start` on the
  throwaway bot answered through the forwarder.
- `pnpm lint typecheck test build e2e` green locally and in CI, e2e against `wrangler dev`.
- Staging Worker on the Free plan: the M1 and M2 definitions of done hold end to end; a
  catalogue sync and a notification fan-out to 25 test members complete inside the hub without
  hitting the CPU or subrequest limits; the Neon console shows compute suspended between
  interactions.
- No `setInterval`/`setTimeout` schedule anywhere in the server, and
  `grep -riE "railway|@hono/node-server|from 'googleapis|pino" apps` finds nothing (the Sheets
  REST hostnames end in `googleapis.com`; the library is what must be gone).

**Verified in M2.5 (code):** `pnpm lint`, `pnpm typecheck`, `pnpm test` (shared 27, Mini App
35, server 218 on Node plus 13 hub tests inside workerd) and `pnpm build` pass; `pnpm e2e`
passes the membership, catalogue and realtime flows against `wrangler dev`. The grep gate is
empty and the only timers left are the Mini App's reconnect backoff. **Not yet verified:** the
staging deploy and the Neon autosuspend observation, which need the accounts.

**Spec corrections made in this milestone:** applicants may open the realtime socket so the
gate no longer polls `/me` (ARCH §4, §7, §11); a failing job is retried by the hub with the
outbox's backoff rather than by the platform (ARCH §9); deployment values are environment
variables consumed by `pnpm deploy:worker` rather than `vars` in `wrangler.jsonc`, so the
repository holds nothing group-specific and `wrangler dev` never sees production values
(ARCH §3, §13, §15); placement is targeted at `aws:eu-central-1`, which Cloudflare supports
directly, overridable with `PLACEMENT_REGION` (ARCH §3).

---

## M3 — Offers and board

**Goal.** Farmers publish surplus and everyone sees, live, what is available.

**Spec.** PRD §7, US-3.1–3.4, N3, N10, N11 · ARCH §5 (offers), §6 offer machine, §7 realtime,
§9 jobs, §11 (offers, board) · ADR-0009 (outbox), 0017 (hub).

**Tasks**
- [x] `domain/offers`: publish (one active per producer+product, 409 with existing), edit with
      `OFFER_QUANTITY_BELOW_HELD` (held = 0 until M4, computed via the real query anyway),
      withdraw, still-available, re-publish detection; unit step validation per unit; unit tests.
- [x] Board query (ARCH §5 derived rules) with grouping/search/category; integration tests for
      visibility rules (own offers hidden, suspended producer hidden, expired hidden, zero
      available hidden).
- [x] `board.changed` published through the hub after offer changes (the socket and the Mini
      App realtime store exist since M2.5); the board store refetches on the event.
- [x] Notifications N3 (new/re-published) to all approved members except producer, respecting
      `notify_new_offer`; deep link `o_<id>`. The fan-out is drained by the hub in batches
      (ARCH §8), never sent from the request.
- [x] Jobs `offers.expire` (00:05 Europe/Madrid) and `offers.nudge` (09:00) registered in the
      hub's schedule with their next-occurrence math (ADR-0017), quick actions `still:<id>` /
      `withdraw:<id>`; stale flag; N10; tests with fake clock.
- [x] N11 reminder list on withdraw (lists open reservations; empty until M4).
- [x] Complete proposal-reject cascade from M2 (withdraw offers on the rejected product),
      and merge references on pending-product rename (ADR-0015; refuse overlapping active
      offers by the same producer rather than combining them).
- [x] Mini App: Board (list, group toggle, search, category chips, offer detail sheet with a
      disabled reserve button until M4), My offers (list, publish form with picker, edit,
      withdraw, fully-reserved and expired states), offer deep link route.

**Definition of done**
- Two browser contexts: producer publishes → requester's board updates without reload → N3
  arrives to requester (fake Telegram) → producer lowers quantity to 0 → offer leaves the board.
- Offer with `available_until` yesterday is expired by the job; offer without date and 7 days
  old gets the nudge; unanswered for 3 more days becomes stale and sorts last.

**Verified in M3:** the two-context Playwright flow runs against `wrangler dev` with a fake
Bot API recording what the hub dispatched (publish → live board → N3 to the requester →
quantity to 0 → gone → raised → re-published); the expiry, nudge, stale and weekly re-nudge
sequence is an integration test with a fake clock (`test/offers-jobs.test.ts`). `pnpm lint`,
`pnpm typecheck`, `pnpm test` and `pnpm build` pass; `pnpm e2e` passes membership, catalogue,
offers and realtime.

**Spec corrections made in this milestone:** a rejected proposal that offers reference is
archived under a tombstone slug instead of deleted, since the foreign key forbids the delete
and the records belong to members (ADR-0018; PRD §12, ARCH §6, §10); after a producer's edit
the calendar decides the status, withdraw also applies to expired offers, and edits clear the
nudge cycle (ARCH §6); the nudge considers dateless offers that still have something to
reserve (PRD US-3.4, ARCH §9); a producer may lower an offer to 0 when nothing is held (PRD
US-3.2, the definition of done above); the board's manual fallback is a refresh button rather
than pull-to-refresh, which the Telegram web view owns (PRD US-3.3); `TELEGRAM_API_ROOT`, a
dev/test-only variable refused in production, points the bot at a fake Bot API so the e2e
suite can assert a notification end to end (ARCH §13, §16).

---

## M4 — Reservations

**Goal.** Reserving holds quantity atomically and every reservation goes through confirm,
deliver, cancel, reject or expire, with both parties informed.

**Spec.** PRD §8 US-4.1–4.6, N6–N8 · ARCH §5 (reservations), §6 reservation machine, §9, §11 · ADR-0004, 0014.

**Tasks**
- [x] `domain/reservations`: create with `SELECT … FOR UPDATE` on the offer (then `held` read in
      a second statement), availability check, price snapshot, `expires_at`;
      confirm/reject/cancel/deliver with actor guards; deliver deducts from offer; price-resolve
      hook wired from catalogue sync; unit tests for every guard in the ARCH §6 table.
- [x] Concurrency integration test: N parallel reservations for the last unit, exactly one wins,
      others get `INSUFFICIENT_AVAILABILITY {available}` (through the domain and through the API).
- [x] Jobs `reservations.remind` and `reservations.expire` as deadline jobs: the hub's next
      `due_at` comes from `min(expires_at − reminder)` / `min(expires_at)`, and every
      reservation transaction ends with `hub.wake()`, which now makes every deadline job due;
      N7, N8; tests with fake clock, including a 1-minute expiry.
- [x] Quick actions `confirm:<id>` / `refuse:<id>` from N6/N7 with stale-button handling
      (`refuse`, because `reject:<id>` is the applicant's; ARCH §4).
- [x] `confirm-and-deliver` (producer, pending, one transaction, both system lines, one N8) in the
      domain and as a Mini App action only — never a quick action (ADR-0014);
      `POST /reservations/:id/confirm-and-deliver`.
- [x] System messages on every transition (thread table exists; rendering comes in M5): the
      body is the event, `meta` names the actor or the cause.
- [x] API: `POST /reservations`, list by side/state, detail, five action endpoints; realtime
      event `reservation.changed` to both parties, `board.changed` when availability moved.
- [x] Mini App: reserve form in offer detail (quantity with unit step, total preview or "price
      pending", conflict handling "only 2 kg left, reserve that?"), Reservations screen
      (incoming/outgoing × active/closed), reservation detail with actions per role and
      state, deep link `r_<id>` (lands on detail until M5 adds the thread).
- [x] Held/available shown in My offers; `OFFER_QUANTITY_BELOW_HELD` surfaced in edit form (the
      M3 screens, now fed by real holds; covered by the API test).

**Definition of done**
- E2E: requester reserves → producer sees N6 and confirms from the quick action → requester
  sees status live → producer marks delivered → offer quantity reduced accordingly.
- E2E: a second reservation goes pending → delivered through the Mini App's *confirm and deliver*,
  leaving the same records as the two-step path and one delivered notification.
- Pending reservation with a 1-minute expiry (test setting) gets reminded and expired by the
  jobs, quantity released, both notified.
- Withdrawing an offer with open reservations keeps them actionable and sends N11.

**Verified in M4:** the two e2e flows run against `wrangler dev` with the fake Bot API: the
quick action is a real `callback_query` posted to the webhook, the requester's screen moves on
`reservation.changed`, the delivery deducts from *My offers*, and the one-tap handover leaves
both timestamps and a single delivered notification. The 1-minute expiry, the reminder window,
the release and the N8 pair are an integration test with a fake clock
(`test/reservations-jobs.test.ts`); withdrawal with open reservations, the catalogue cascade and
a five-way race for the last unit are in `test/reservations.test.ts`, and a six-way race through
the routes in `test/reservations-api.test.ts`. `pnpm lint`, `pnpm typecheck`, `pnpm test` and
`pnpm build` pass; `pnpm e2e` passes membership, catalogue, offers, realtime and reservations.

**Spec corrections made in this milestone:** the reservation's *Reject* quick action is
`refuse:<id>` on the wire, since `reject:<id>` already names the applicant's decision and an id
alone does not say which table it belongs to (ARCH §4); `confirm-and-deliver` is a fifth action
endpoint rather than a flag on `/deliver` (ARCH §6, §11); the offer row is locked before `held`
is read, in two statements, so the availability check sees reservations committed while the
lock was awaited, and the offers service's held floor now does the same (ARCH §6);
`hub.wake()` makes every deadline job due, not only the dispatcher, so one wake covers a
notification and a deadline written in the same commit (ARCH §9); row locks go reservation
first, then offer (ARCH §6); a rejected proposal's open reservations are cancelled with N8 to
both parties and N5 goes to the proposer and the producers, rather than N5 to the requesters
(PRD US-2.2, §9; ARCH §10); anyone who is not a party gets `FORBIDDEN` and a stale action gets
`INVALID_TRANSITION` with the current status, while reserving a withdrawn, expired or suspended
producer's offer is also `INVALID_TRANSITION` and reserving one's own is `FORBIDDEN` (ARCH §11).

---

## M5 — Chat

**Goal.** Each reservation has a private, live conversation with its context pinned.

**Spec.** PRD US-5.1–5.2, N9 · ARCH §7, §8 (throttle), §11 (messages, read, presence) · ADR-0005, 0009.

**Tasks**
- [ ] `domain/threads`: post message (length, party check, read-only after
      `thread_readonly_days_after_close`), read markers, presence, unread counts per reservation
      and total; unit tests.
- [ ] N9 with `dedupe_key` throttle; cleared on read; skipped when recipient is viewing the
      thread; integration tests for the burst behaviour.
- [ ] Realtime event `message.new`; API messages (paginated `after`), read; presence as the
      `{viewing}` socket message answered by `hub.isViewing` (ARCH §7).
- [ ] Mini App: thread screen (context header with actions from M4, message list, composer with
      `MainButton`, optimistic send, system lines, read-only banner), unread badges on
      Reservations tab and rows, **Open in Telegram** when counterpart has a username.
- [ ] `GET /me` returns unread totals; badge updates over the socket.

**Definition of done**
- E2E with two contexts: messages appear on both sides within a second; closing one context and
  sending three messages yields exactly one N9 to it; opening the thread clears the badge.
- A thread of a reservation delivered 8 days ago (test clock) is read-only with a banner.

---

## M6 — Admin, hardening, launch

**Goal.** The group uses AgroBot 2.0 for real.

**Spec.** PRD §10, §12, §13 · ARCH §15, §17 · ADR-0008 (deletion task), 0013 (cutover), 0016
(hosting).

**Tasks**
- [ ] Admin → Settings screen with validation per key; settings read by jobs and domain at run
      time (no restart).
- [ ] Rate limiting (per member, per thread), body limits, HTML escaping audit, `pnpm audit`
      report in CI, dependency review.
- [ ] Sentry hook (optional by env), `/status` complete, structured error ids surfaced in toasts.
- [ ] Full Playwright suite in CI (M1–M5 scenarios), flaky-test policy documented.
- [ ] Production deploy (ADR-0016): the `agrobot` Worker with its secrets, the Neon
      `production` branch and its Hyperdrive configuration, custom domain if any (`PUBLIC_URL`
      follows), Mini App short name on the 1.0 bot pointing at `PUBLIC_URL`; restore drill
      against staging: branch Neon at a timestamp inside the six-hour window, re-point the
      staging Hyperdrive at it, verify the data; runbook in `docs/runbook.md` (deploy,
      `wrangler rollback`, rotate bot token, re-sync catalogue, unstick a notification, re-arm
      the hub, weekly free-plan budget check: Workers requests and CPU, hub requests and
      duration, Hyperdrive queries, Neon CU-hours).
- [ ] Bot cutover (ADR-0013): stop 1.0, then `pnpm bot:set-webhook` with the 1.0 token against
      the production Worker — the two can never run at once. Rollback is re-pointing the
      webhook at 1.0; rehearse it.
- [ ] Pilot with the group: onboarding message, `Productes` tab prepared and shared with the
      service account (PRD §6), admins bootstrapped, one week of feedback triage into GitHub
      issues.
- [x] Resolve PRD §13 open questions in the docs (edit PRD/ADRs, do not leave them stale).
- [ ] After a stable week: tag `v1-legacy`, delete `legacy/`, tag `v2.0.0`.

**Definition of done**
- 2.0 in production, all members of the group approved, catalogue synced from the real sheet.
- CI green on `main`, e2e included; runbook followed once for a deploy and once for a rollback.
- After the pilot week every free-plan figure in ARCH §15's budget table is under a quarter of
  its cap, and Neon's monthly compute is on track for well under 100 CU-hours.
- No open P1 issues after the pilot week.

---

## Post-2.0 backlog

In the order we currently expect to want them; each one becomes a PRD section + ADR when
picked up.

1. Nightly encrypted off-site database dump (GitHub Actions `pg_dump`, encrypted with `age`,
   to a private Cloudflare R2 bucket, 10 GB free), if Neon's six-hour restore window ever
   feels short (ADR-0016 accepted point-in-time restore alone).
2. Personal history beyond 30 days and per-farmer totals (data already there, ADR-0011).
3. Settlement view and CSV export for admins.
4. Daily digest mode for new-offer notifications.
5. Photos on offers.
6. Auto-expire stale offers after prolonged silence.
7. Multiple offers of the same product per producer.
8. Several groups per deployment.
