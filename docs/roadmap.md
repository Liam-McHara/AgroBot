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
| [M3 Offers and board](#m3--offers-and-board) | Publish/edit/withdraw, board, new-offer notifications, expiry and nudges. | M2 |
| [M4 Reservations](#m4--reservations) | Full lifecycle with jobs, notifications, quick actions, screens. | M3 |
| [M5 Chat](#m5--chat) | Threads, SSE, unread, throttled notifications, native DM link. | M4 |
| [M6 Admin, hardening, launch](#m6--admin-hardening-launch) | Admin members/settings, rate limits, e2e, docs, production, pilot. | M5 |
| [Post-2.0 backlog](#post-20-backlog) | Deferred items, in the order we expect to want them. | 2.0 live |

Estimated effort is deliberately not given per task; the milestone ordering and definitions of
done are the commitment.

---

## M0 — Foundation

**Goal.** A developer (or a fresh Claude Code session) can clone, run `pnpm dev`, get a
running server with a migrated database and a blank Mini App, and CI is green.

**Spec.** ARCH §2, §3, §13–§16 · ADR-0002, 0006, 0008, 0012 (Railway), 0013 (bot identity).

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
- [x] `Dockerfile` multi-stage; `railway.json` (ADR-0012); migrations on boot.
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

**Spec.** PRD §6, US-2.1–2.2, N4, N5, N12 · ARCH §10, §11 (products, admin/catalog) · ADR-0003.

**Tasks**
- [ ] `integrations/google-sheets.ts` (service account) and `csv-catalog.ts` behind one
      `CatalogSource` interface; header alias normalization (ca/es/en); row parser with zod,
      unit mapping, price parsing (`,`/`.`); unit tests with fixture sheets incl. broken rows.
- [ ] `domain/catalog`: `applyDiff` in one transaction (upsert by slug, archive missing,
      un-archive, resolve pending by slug, price-resolve open reservations — the last one is a
      no-op until M4 but the hook exists), content-hash short-circuit, zero-valid-rows guard,
      `catalog_syncs` logging; integration tests.
- [ ] Job `catalog.sync` hourly + on boot if never synced; admin `POST /admin/catalog/sync`;
      bot `/sync` (admin only) and `/status`.
- [ ] Proposals: `POST /products/proposals`, N4 to admins with the exact name; admin
      `rename` / `reject` (reject cascades are stubs until offers exist in M3, then completed).
- [ ] API `GET /products` (search, includes my pending), `GET /admin/catalog`.
- [ ] Mini App: product picker component (search, "Propose «…»" with unit choice), Admin →
      Catalogue (last sync, errors table, product list with status filters, pending products
      with rename/reject and copy-to-clipboard name, link to the sheet).
- [ ] N12 on failed sync.

**Definition of done**
- Pointing the app at a test sheet imports it; editing a price and re-syncing updates it; deleting
  a row archives the product; a row with an unknown unit is reported by row number and the
  rest is applied; an empty sheet is rejected and admins notified.
- A member proposes "tomàquet cor de bou", admins are notified, adding the row to the sheet
  resolves it on the next sync (integration test with the CSV source).

---

## M3 — Offers and board

**Goal.** Farmers publish surplus and everyone sees, live, what is available.

**Spec.** PRD §7, US-3.1–3.4, N3, N10, N11 · ARCH §5 (offers), §6 offer machine, §7 SSE, §9 jobs, §11 (offers, board) · ADR-0009.

**Tasks**
- [ ] `domain/offers`: publish (one active per producer+product, 409 with existing), edit with
      `OFFER_QUANTITY_BELOW_HELD` (held = 0 until M4, computed via the real query anyway),
      withdraw, still-available, re-publish detection; unit step validation per unit; unit tests.
- [ ] Board query (ARCH §5 derived rules) with grouping/search/category; integration tests for
      visibility rules (own offers hidden, suspended producer hidden, expired hidden, zero
      available hidden).
- [ ] SSE hub + `GET /api/events`; `board.changed` emitted after offer changes; Mini App SSE
      store with reconnect and refetch.
- [ ] Notifications N3 (new/re-published) to all approved members except producer, respecting
      `notify_new_offer`; deep link `o_<id>`.
- [ ] Jobs `offers.expire` (daily 00:05 Europe/Madrid + boot) and `offers.nudge` (daily 09:00)
      with quick actions `still:<id>` / `withdraw:<id>`; stale flag; N10; tests with fake clock.
- [ ] N11 reminder list on withdraw (lists open reservations; empty until M4).
- [ ] Complete proposal-reject cascade from M2 (withdraw offers on the rejected product).
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
- [ ] Jobs `reservations.remind` and `reservations.expire`; N7, N8; tests with fake clock.
- [ ] Quick actions `confirm:<id>` / `reject:<id>` from N6/N7 with stale-button handling.
- [ ] `confirm-and-deliver` (producer, pending, one transaction, both system lines, one N8) in the
      domain and as a Mini App action only — never a quick action (ADR-0014).
- [ ] System messages on every transition (thread table exists; rendering comes in M5).
- [ ] API: `POST /reservations`, list by side/state, detail, four action endpoints; SSE
      `reservation.changed`.
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
- [ ] SSE `message.new`; API messages (paginated `after`), read, presence.
- [ ] Mini App: thread screen (context header with actions from M4, message list, composer with
      `MainButton`, optimistic send, system lines, read-only banner), unread badges on
      Reservations tab and rows, **Open in Telegram** when counterpart has a username.
- [ ] `GET /me` returns unread totals; badge updates over SSE.

**Definition of done**
- E2E with two contexts: messages appear on both sides within a second; closing one context and
  sending three messages yields exactly one N9 to it; opening the thread clears the badge.
- A thread of a reservation delivered 8 days ago (test clock) is read-only with a banner.

---

## M6 — Admin, hardening, launch

**Goal.** The group uses AgroBot 2.0 for real.

**Spec.** PRD §10, §12, §13 · ARCH §15, §17 · ADR-0008 (deletion task), 0012, 0013 (cutover).

**Tasks**
- [ ] Admin → Settings screen with validation per key; settings read by jobs and domain at run
      time (no restart).
- [ ] Rate limiting (per member, per thread), body limits, HTML escaping audit, `pnpm audit`
      report in CI, dependency review.
- [ ] Sentry hook (optional by env), `/status` complete, structured error ids surfaced in toasts.
- [ ] Full Playwright suite in CI (M1–M5 scenarios), flaky-test policy documented.
- [ ] Production deploy: Railway project and Postgres (ADR-0012), secrets, Mini App short name on
      the 1.0 bot, custom domain if any; backups verified by a restore drill; runbook in
      `docs/runbook.md` (deploy, rollback, rotate bot token, re-sync catalogue, unstick a
      notification).
- [ ] Bot cutover (ADR-0013): stop 1.0, then register the 2.0 webhook on the same token — the two
      can never run at once. Rollback is re-pointing the webhook at 1.0; rehearse it.
- [ ] Pilot with the group: onboarding message, `Productes` tab prepared and shared with the
      service account (PRD §6), admins bootstrapped, one week of feedback triage into GitHub
      issues.
- [x] Resolve PRD §13 open questions in the docs (edit PRD/ADRs, do not leave them stale).
- [ ] After a stable week: tag `v1-legacy`, delete `legacy/`, tag `v2.0.0`.

**Definition of done**
- 2.0 in production, all members of the group approved, catalogue synced from the real sheet.
- CI green on `main`, e2e included; runbook followed once for a deploy and once for a rollback.
- No open P1 issues after the pilot week.

---

## Post-2.0 backlog

In the order we currently expect to want them; each one becomes a PRD section + ADR when
picked up.

1. Personal history beyond 30 days and per-farmer totals (data already there, ADR-0011).
2. Settlement view and CSV export for admins.
3. Daily digest mode for new-offer notifications.
4. Photos on offers.
5. Auto-expire stale offers after prolonged silence.
6. Multiple offers of the same product per producer.
7. Several groups per deployment.
