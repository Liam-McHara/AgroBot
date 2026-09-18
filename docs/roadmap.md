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
- [ ] Accounts and bindings: Neon project (Frankfurt, `aws-eu-central-1`) with `production` and
      `staging` branches; a Hyperdrive configuration per branch pointing at the pooled
      connection string; `apps/server/wrangler.jsonc` with the assets, Hyperdrive and Durable
      Object bindings, the `nodejs_compat` flag, `placement` in the database's region,
      `observability.enabled`, the 15-minute heartbeat cron, and a `staging` environment.
      Secrets with `wrangler secret put`; plain values as `vars`.
- [ ] Worker entry `src/worker.ts`: `fetch` builds the deps per request (env from bindings, a
      postgres.js client on `env.HYPERDRIVE.connectionString` closed in `waitUntil`) and mounts
      the Hono app; `env.ts` takes a bindings object and loses `BOT_MODE`, `PORT`, `LOG_PRETTY`;
      the Mini App is served by Static Assets (`single-page-application`, `run_worker_first` for
      `/api/*`, `/telegram/*`, `/health`), so `app.ts` loses `serveStatic` and the SPA fallback.
- [ ] `realtime/hub.ts`: Durable Object `AgroBotHub` (SQLite) with the `schedule(job, due_at)`
      table and a single alarm; `wake()`, `ensureArmed()`, `runJob(name)`; next-occurrence math
      in Europe/Madrid for periodic jobs; deadline lookups for dispatch/remind/expire; tests
      under `@cloudflare/vitest-pool-workers` with a fake clock, including DST days.
- [ ] Jobs on the hub: `notifications.dispatch` in batches of 20, immediate re-arm while rows
      remain, retries at `next_attempt_at`; `catalog.sync` hourly and on demand (`/sync` and
      `POST /admin/catalog/sync` await `hub.runJob`); delete `jobs/scheduler.ts`. Domain code
      calls `hub.wake()` after commits that enqueue; integration tests keep calling the job
      functions directly.
- [ ] WebSocket hub: `POST /api/events/ticket` (random, single-use, 30 s, stored in the hub),
      `GET /api/events?ticket=` upgrade with `Origin` check forwarded to the hub, Hibernation
      API with member tags, `publish(memberIds, event)`, `isViewing`, per-member rate counters.
      Mini App realtime store (one `WebSocket`, reconnect with backoff, `{viewing}` messages)
      behind the same `refetch()` interface; `me.changed` on `PATCH /me` proves the path end to
      end.
- [ ] Replace `googleapis` with `integrations/google-sheets.ts` on `fetch` + WebCrypto (RS256
      JWT → access token → `values.get`), same `CatalogSource` interface, tests with a mocked
      `fetch`. Replace `pino` with the JSON console logger behind the existing `Logger` type.
- [ ] Remove the Node runtime: `src/index.ts`, `@hono/node-server`, polling mode, `Dockerfile`,
      `.dockerignore`. Keep `tsx` and `drizzle-kit` for `db:migrate`, `db:seed`, `db:generate`
      and the scripts, which stay Node CLIs.
- [ ] Dev loop: `pnpm dev` = `wrangler dev --port 8080` + `vite` + `scripts/dev-telegram.mjs`
      (deletes the throwaway bot's webhook, long-polls `getUpdates`, POSTs each update to the
      local webhook with the secret header); `scripts/set-webhook.mjs` as `pnpm bot:set-webhook`
      for tunnels and production. One `.env`, read by wrangler, Vite and the scripts.
- [ ] CI: `wrangler deploy --dry-run` inside `pnpm build`; e2e boots `wrangler dev` (local
      Hyperdrive → `agrobot_test`) instead of `node dist/index.js`; a `deploy` job on `main`
      after the checks runs `pnpm db:migrate` against Neon, `wrangler deploy --var GIT_COMMIT`,
      then `pnpm bot:set-webhook`. Repository secrets: `CLOUDFLARE_API_TOKEN`,
      `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`, `BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
      `PUBLIC_URL`.
- [ ] First deploy to the **staging** Worker with a throwaway bot and the Neon `staging`
      branch: `/start`, approval from a quick action, a catalogue sync from a test sheet, one
      realtime event, and the Neon console showing compute suspended between interactions.
- [ ] Docs brought in line with what shipped: README getting started and deployment, AGENTS.md
      commands, ARCH §13–§15; check ADR-0016/0017's consequences against reality and add a
      new ADR if one turned out wrong.

**Definition of done**
- `pnpm install && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` from a
  clean clone following only the README: Mini App at `:5173`, Worker at `:8080`, `/start` on the
  throwaway bot answered through the forwarder.
- `pnpm lint typecheck test build e2e` green locally and in CI, e2e against `wrangler dev`.
- Staging Worker on the Free plan: the M1 and M2 definitions of done hold end to end; a
  catalogue sync and a notification fan-out to 25 test members complete inside the hub without
  hitting the CPU or subrequest limits; the Neon console shows compute suspended between
  interactions.
- No `setInterval`/`setTimeout` schedule anywhere, and
  `grep -ri "railway\|@hono/node-server\|googleapis\|pino" apps` finds nothing.

---

## M3 — Offers and board

**Goal.** Farmers publish surplus and everyone sees, live, what is available.

**Spec.** PRD §7, US-3.1–3.4, N3, N10, N11 · ARCH §5 (offers), §6 offer machine, §7 realtime,
§9 jobs, §11 (offers, board) · ADR-0009 (outbox), 0017 (hub).

**Tasks**
- [ ] `domain/offers`: publish (one active per producer+product, 409 with existing), edit with
      `OFFER_QUANTITY_BELOW_HELD` (held = 0 until M4, computed via the real query anyway),
      withdraw, still-available, re-publish detection; unit step validation per unit; unit tests.
- [ ] Board query (ARCH §5 derived rules) with grouping/search/category; integration tests for
      visibility rules (own offers hidden, suspended producer hidden, expired hidden, zero
      available hidden).
- [ ] `board.changed` published through the hub after offer changes (the socket and the Mini
      App realtime store exist since M2.5); the board store refetches on the event.
- [ ] Notifications N3 (new/re-published) to all approved members except producer, respecting
      `notify_new_offer`; deep link `o_<id>`. The fan-out is drained by the hub in batches
      (ARCH §8), never sent from the request.
- [ ] Jobs `offers.expire` (00:05 Europe/Madrid) and `offers.nudge` (09:00) registered in the
      hub's schedule with their next-occurrence math (ADR-0017), quick actions `still:<id>` /
      `withdraw:<id>`; stale flag; N10; tests with fake clock.
- [ ] N11 reminder list on withdraw (lists open reservations; empty until M4).
- [ ] Complete proposal-reject cascade from M2 (withdraw offers on the rejected product),
      and merge references on pending-product rename (ADR-0015; refuse overlapping active
      offers by the same producer rather than combining them).
- [ ] Mini App: Board (list, group toggle, search, category chips, offer detail sheet with a
      disabled reserve button until M4), My offers (list, publish form with picker, edit,
      withdraw, fully-reserved and expired states), offer deep link route.

**Definition of done**
- Two browser contexts: producer publishes → requester's board updates without reload → N3
  arrives to requester (fake Telegram) → producer lowers quantity to 0 → offer leaves the board.
- Offer with `available_until` yesterday is expired by the job; offer without date and 7 days
  old gets the nudge; unanswered for 3 more days becomes stale and sorts last.

---

## M4 — Reservations

**Goal.** Reserving holds quantity atomically and every reservation goes through confirm,
deliver, cancel, reject or expire, with both parties informed.

**Spec.** PRD §8 US-4.1–4.6, N6–N8 · ARCH §5 (reservations), §6 reservation machine, §9, §11 · ADR-0004, 0014.

**Tasks**
- [ ] `domain/reservations`: create with `SELECT … FOR UPDATE` on the offer, availability check,
      price snapshot, `expires_at`; confirm/reject/cancel/deliver with actor guards; deliver
      deducts from offer; price-resolve hook wired from catalogue sync; unit tests for every
      guard in the ARCH §6 table.
- [ ] Concurrency integration test: N parallel reservations for the last unit, exactly one wins,
      others get `INSUFFICIENT_AVAILABILITY {available}`.
- [ ] Jobs `reservations.remind` and `reservations.expire` as deadline jobs: the hub's next
      `due_at` comes from `min(expires_at − reminder)` / `min(expires_at)`, and every
      reservation transaction ends with `hub.wake()`; N7, N8; tests with fake clock.
- [ ] Quick actions `confirm:<id>` / `reject:<id>` from N6/N7 with stale-button handling.
- [ ] `confirm-and-deliver` (producer, pending, one transaction, both system lines, one N8) in the
      domain and as a Mini App action only — never a quick action (ADR-0014).
- [ ] System messages on every transition (thread table exists; rendering comes in M5).
- [ ] API: `POST /reservations`, list by side/state, detail, four action endpoints; realtime
      event `reservation.changed`.
- [ ] Mini App: reserve form in offer detail (quantity with unit step, total preview or "price
      pending", conflict handling "only 2 kg left, reserve that?"), Reservations screen
      (incoming/outgoing × active/closed), reservation detail with actions per role and
      state, deep link `r_<id>` (lands on detail until M5 adds the thread).
- [ ] Held/available shown in My offers; `OFFER_QUANTITY_BELOW_HELD` surfaced in edit form.

**Definition of done**
- E2E: requester reserves → producer sees N6 and confirms from the quick action → requester
  sees status live → producer marks delivered → offer quantity reduced accordingly.
- E2E: a second reservation goes pending → delivered through the Mini App's *confirm and deliver*,
  leaving the same records as the two-step path and one delivered notification.
- Pending reservation with a 1-minute expiry (test setting) gets reminded and expired by the
  jobs, quantity released, both notified.
- Withdrawing an offer with open reservations keeps them actionable and sends N11.

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
