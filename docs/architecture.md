# AgroBot 2.0 — Architecture

_Technical design that implements [prd.md](prd.md). Decisions with alternatives are recorded
in [adr/](adr/README.md); this document states what we build and how the pieces fit._

## 1. Overview

```
                    Telegram servers
                 ┌─────────┴──────────┐
        webhook  │                    │  Mini App web view
        (bot)    ▼                    ▼  (HTTPS)
┌──────────────────────────────────────────────────────────┐
│  apps/server  (one Node 22 process, one container)       │
│                                                          │
│  Hono HTTP                                               │
│   ├─ POST /telegram/webhook   → grammY bot (commands,    │
│   │                              quick-action callbacks) │
│   ├─ /api/*                   → REST JSON for Mini App   │
│   ├─ GET /api/events          → SSE stream per member    │
│   ├─ GET /health                                         │
│   └─ /*                       → static Mini App build    │
│                                                          │
│  Domain services (pure TS) ── Drizzle ORM ── Postgres    │
│  Jobs (in-process scheduler):                            │
│   catalog sync · reservation expiry/reminders ·          │
│   offer expiry/nudges · notification outbox dispatcher   │
└──────────────────────────────────────────────────────────┘
                              │
                 Google Sheets API (service account)
                 or published CSV URL
```

One deployable unit. No queue, no cache server, no second process. Scaling beyond one
instance is out of scope and the only place it would matter (SSE fan-out) is isolated behind
an interface (§7).

## 2. Repository layout (pnpm workspace)

```
.
├── apps/
│   ├── server/                 # Hono + grammY + Drizzle + jobs
│   │   ├── src/
│   │   │   ├── index.ts        # bootstrap: env, db, bot, http, jobs
│   │   │   ├── env.ts          # zod-validated process.env
│   │   │   ├── db/             # drizzle schema, migrations, client, seeds
│   │   │   ├── domain/         # one folder per aggregate: members, catalog, offers,
│   │   │   │                   #   reservations, threads, notifications, settings
│   │   │   │                   #   (services + state machines, no HTTP/Telegram code)
│   │   │   ├── http/           # Hono app, middlewares (auth, errors, logging), routes
│   │   │   ├── bot/            # grammY: commands, callback (quick action) handlers,
│   │   │   │                   #   notifications/ (renderers per kind), deep links
│   │   │   ├── jobs/           # scheduler + job implementations
│   │   │   ├── integrations/   # google-sheets.ts, csv-catalog.ts, telegram-api.ts
│   │   │   ├── realtime/       # SSE hub
│   │   │   └── i18n/           # server-side t() bound to member language
│   │   ├── test/               # integration tests (real Postgres)
│   │   └── Dockerfile
│   └── miniapp/                # Svelte 5 + Vite, Telegram Mini App SDK
│       ├── index.html          # Vite entry point (plain SPA, not SvelteKit)
│       └── src/
│           ├── main.ts         # mounts App.svelte, initialises Telegram and i18n
│           ├── lib/api/        # typed client generated from shared contracts
│           ├── lib/i18n/
│           ├── lib/stores/     # me, board, reservations, sse
│           ├── lib/telegram.ts # SDK init, initData, theme variables
│           └── routes/         # board, offers, reservations, thread, settings, admin, gate
├── packages/
│   └── shared/                 # zod schemas (API contracts), domain enums, i18n messages
│       └── src/
│           ├── contracts/      # request/response schemas per endpoint
│           ├── enums.ts        # statuses, units, notification kinds, error codes
│           ├── i18n/           # t() with plural/number/date formatting
│           └── messages/       # ca.json, es.json (+ typed keys)
├── docs/                       # this specification
├── e2e/                        # Playwright suite against the built server (§15)
├── legacy/                     # AgroBot 1.0, frozen
├── scripts/                    # workspace scripts (i18n catalogue check, Postgres init)
├── docker-compose.yml          # local Postgres
├── railway.json                # deploy configuration (ADR-0012)
├── .github/workflows/ci.yml
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js
└── CLAUDE.md, README.md, .env.example
```

Rules of dependency: `miniapp` and `server` depend on `shared`; nothing depends on `legacy`.
`domain/` never imports from `http/`, `bot/` or `integrations/`; it receives ports (db
transaction, clock, notifier, event bus) as parameters so it is unit-testable.

## 3. Runtime and libraries

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node 22 LTS, ESM, TypeScript strict | `tsx` for dev, `tsc` build. |
| HTTP | **Hono** | Tiny, typed, runs on Node via `@hono/node-server`; `zod-validator` for bodies. |
| Bot | **grammY** | Webhook mode in production (`webhookCallback(bot, "hono")`), long polling in dev (`BOT_MODE=polling`). Plugins: `@grammyjs/i18n` not used (we share our own catalogue), `auto-retry` transformer for 429s. |
| DB | **Postgres 16 + Drizzle ORM** | `drizzle-kit` migrations committed in `apps/server/src/db/migrations`. Driver `postgres` (postgres.js). |
| Validation | **zod** in `packages/shared` | Single source for API contracts; server validates, client infers types. |
| Frontend | **Svelte 5 + Vite**, `@telegram-apps/sdk` | Router: `svelte-spa-router` (hash routes), decided in M1: a plain SPA with no framework server side, fewer moving parts than SvelteKit. |
| Realtime | Server-Sent Events | Native `EventSource` in the Mini App; no socket library. |
| Scheduler | `croner` (or `setInterval` with jitter) inside the server process | Jobs are idempotent and lease-free because there is one instance. |
| Google Sheets | `googleapis` (Sheets v4) with a service account | Fallback mode: fetch a published-CSV URL with `undici` and parse with `csv-parse`. |
| Logging | `pino` | JSON logs, request id middleware. |
| Tests | **Vitest** (unit + integration), **Playwright** (e2e), `@testing-library/svelte` | Integration tests run against the docker-compose Postgres (CI: service container). |
| Lint/format | ESLint (typescript-eslint, svelte plugin) + Prettier | `pnpm lint`, `pnpm format:check` in CI. |
| Package manager | pnpm 10 | Workspaces, `pnpm -r` scripts; the version is pinned in `packageManager`. |

## 4. Authentication and authorization

### Mini App → API
- The Mini App sends `Authorization: tma <initDataRaw>` on every request (convention of the
  Telegram Mini Apps SDK).
- Middleware `auth.ts` validates the HMAC-SHA256 signature with the bot token, rejects
  `auth_date` older than 24 h, parses `user`, and loads/creates the member row
  (`members.telegram_id`). It updates `username`, `first_name`, `last_name`, `last_seen_at`
  when they changed.
- Result is attached to context as `ctx.var.member` with `status` and `role`.
- Route guards: `requireMember` (status `approved`), `requireAdmin` (role `admin`). Applicants
  and suspended members can only call `GET /api/me`, which is how the gate screen knows what
  to show; everything else answers 403 with `NOT_APPROVED` or `SUSPENDED`. The guards call
  `domain/members` (`assertMember`, `assertAdmin`), and admin actions re-check the actor's row
  inside their transaction, so a stale in-memory copy can never authorize anything.
- Dev only: if `DEV_AUTH_BYPASS_TELEGRAM_ID` is set **and** `NODE_ENV !== 'production'`, a
  request with `Authorization: dev <telegramId>` is accepted. The Mini App sends it whenever it
  is not running inside Telegram (no `initData`), in development and in the e2e suite alike;
  the server is the only gate, so a production build opened in a browser gets a 401.

### Telegram → bot
- Webhook URL `POST /telegram/webhook`, registered on boot with
  `secret_token = TELEGRAM_WEBHOOK_SECRET`; grammY checks the header.
- Quick-action callbacks carry `action:entityId` in `callback_data` (≤ 64 bytes); handlers
  resolve the member from `from.id` and call the same domain service the API would call, so
  permission checks are shared.

### Deep links
- Notification buttons open `https://t.me/<BOT_USERNAME>/<MINIAPP_SHORT_NAME>?startapp=<param>`.
- `start_param` grammar: `r_<reservationId>` (thread), `o_<offerId>` (offer), `a_members`,
  `a_catalog` (admin screens). The Mini App reads it once on launch and routes.

## 5. Data model

Postgres, UUID primary keys (`gen_random_uuid()`), `timestamptz` everywhere, `numeric(10,2)`
for quantities, integer cents for money. Drizzle schema lives in `apps/server/src/db/schema/`.

```
members            member_invites        units (seeded)       products
────────           ──────────────        ──────────────       ────────
id                 id                    code PK              id
telegram_id  UQ    telegram_id  NULL     name_ca              slug UQ (normalized name)
username           username     NULL     name_es              name
first_name         created_by → members  allows_decimals      name_es NULL
last_name          created_at            step numeric         unit_code → units
display_name       used_by → members     sort_order           price_cents NULL (pending)
language ca|es     used_at                                    currency 'EUR'
role member|admin                                             category NULL
status pending|approved|rejected|suspended                    status active|archived|pending
applied_at, approved_at, approved_by → members                source sheet|member
last_seen_at, created_at, updated_at                          proposed_by → members NULL
                                                              created_at, updated_at

offers                          reservations                        messages
──────                          ────────────                        ────────
id                              id                                  id
producer_id → members           offer_id → offers                   reservation_id → reservations
product_id → products           requester_id → members              sender_id → members NULL (system)
quantity numeric                producer_id → members (denorm)      kind text|system
note NULL                       quantity numeric                    body
available_until date NULL       unit_price_cents NULL (pending)     meta jsonb NULL
status active|withdrawn|expired currency 'EUR'                      created_at
stale bool                      status pending|confirmed|delivered
last_activity_at                       |rejected|cancelled|expired  thread_reads
nudged_at NULL                  reason NULL                         ────────────
created_at, updated_at          closed_by → members NULL            reservation_id, member_id PK
                                expires_at NULL                     last_read_message_id NULL
UQ (producer_id, product_id)    reminded_at NULL                    last_read_at
  WHERE status = 'active'       created_at, confirmed_at NULL,
                                delivered_at NULL, closed_at NULL, updated_at

notifications (outbox)          catalog_syncs                    settings
──────────────────────          ─────────────                    ────────
id                              id                               key PK
member_id → members             started_at, finished_at          value jsonb
kind (N1..N12 codes)            trigger schedule|manual|command  updated_at, updated_by
payload jsonb                   status ok|partial|failed
dedupe_key NULL UQ              source sheets|csv
status queued|sent|failed       rows_read, created, updated,
attempts, next_attempt_at       archived, resolved_pending
telegram_message_id NULL        errors jsonb  [{row, reason}]
error NULL                      triggered_by → members NULL
created_at, sent_at NULL
```

Derived, never stored:
- `offer.held = Σ reservation.quantity WHERE offer_id = … AND status IN ('pending','confirmed')`
- `offer.available = offer.quantity − offer.held`
- Board query: offers `status='active'`, `available > 0`, `(available_until IS NULL OR
  available_until >= today_madrid)`, producer `status='approved'`, producer ≠ me.

Indexes: `reservations(offer_id, status)`, `reservations(requester_id, status)`,
`reservations(producer_id, status)`, `reservations(status, expires_at)`,
`messages(reservation_id, created_at)`, `notifications(status, next_attempt_at)`,
`offers(status, available_until)`, `products(status)`.

### Delivered deducts, everything else releases
On `delivered`, the service **subtracts** the reservation quantity from `offers.quantity`
inside the same transaction, so the reservation no longer counts as held and the figure
shown to the producer ("you have 4 kg left") stays truthful. All other terminal states simply
stop counting as held.

## 6. State machines

### Reservation

```
                 confirm (producer)                deliver (either)
  ┌─────────┐ ───────────────────────► ┌───────────┐ ─────────────► ┌───────────┐
  │ pending │                          │ confirmed │                │ delivered │
  └─────────┘ ◄─ (no way back)         └───────────┘                └───────────┘
     │  │  │                                │
     │  │  └─ reject (producer) ──► rejected│
     │  └──── cancel (requester) ──► cancelled ◄── cancel (requester or producer)
     └─────── expire (job, at expires_at) ──► expired
```

The Mini App's *confirm and deliver* is the top row travelled in one transaction, not a new
edge: the reservation still passes through `confirmed`, so no guard, status or record differs
from the two-step path.

| Transition | Actor | Guard | Side effects |
|---|---|---|---|
| create | requester | offer reservable, quantity ≤ available (row lock), requester ≠ producer | snapshot price, `expires_at`, N6, system line "reserved", SSE `reservation.changed` + `board.changed` |
| confirm | producer | pending | clear `expires_at`, N8, system line |
| reject | producer | pending | reason, N8, release, system line |
| cancel | requester (pending/confirmed), producer (confirmed) | | reason, `closed_by`, N8, release, system line |
| deliver | either | confirmed | deduct from offer, N8, system line |
| confirm-and-deliver | producer, Mini App only | pending | one transaction: the `confirm` then the `deliver` side effects, both system lines, a **single** N8 (`delivered`). Not offered as a bot quick action. |
| remind | job | pending, `reminded_at IS NULL`, now ≥ `expires_at − reminder` | N7, set `reminded_at` |
| expire | job | pending, now ≥ `expires_at` | N8 to both, release, system line |
| price-resolve | catalog sync | `unit_price_cents IS NULL`, product resolved, status active | set snapshot, N5 |

### Offer

```
  publish ──► active ──(withdraw)──► withdrawn
                 │
                 ├──(available_until passed, job)──► expired
                 │
                 └──(nudge job)── stale=true/false flag, status unchanged
```
Editing quantity/date/note keeps `active`. A quantity edit that makes `available` go from 0
to > 0, or a date edit that brings an `expired` offer back, sets status `active` and
re-triggers N3 ("re-published"). `expired`/`withdrawn` offers are editable by the producer to
re-activate them (same rules).

### Member
`pending → approved → suspended ⇄ approved`, `pending → rejected`, `rejected → approved`
(admin changes their mind). Role `member ⇄ admin` orthogonal to status.

### Product
`pending → active` (sync match or admin rename that matches), `pending → (deleted)` on admin
reject (offers withdrawn, reservations cancelled), `active ⇄ archived` by sync.

## 7. Realtime (SSE)

- `GET /api/events` (auth required) keeps the response open, sends `: ping` every 25 s, and
  pushes named events as JSON: `board.changed {}`, `reservation.changed {id}`,
  `message.new {reservationId, message}`, `me.changed {}`.
- `realtime/hub.ts` keeps `Map<memberId, Set<Response>>` and exposes `publish(memberIds,
  event)` and `isOnline(memberId, reservationId?)` (the client reports which thread it is
  viewing via `POST /api/reservations/:id/presence` on open/close; used only for the chat
  notification throttle).
- Domain services emit events through a `DomainEvents` port after the transaction commits.
  The hub is one subscriber; the notification enqueuer is another.
- Clients react by refetching the affected query (board, reservation, thread). Simple and
  robust; no client-side reconciliation logic.

## 8. Notifications (outbox)

1. Domain code inserts a `notifications` row **in the same transaction** as the state change
   (`kind`, `member_id`, `payload`, optional `dedupe_key`).
2. The dispatcher job runs every 2 s: `SELECT … WHERE status='queued' AND next_attempt_at <=
   now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`, renders text + inline keyboard
   in the recipient's language, calls `sendMessage`, marks `sent` (stores
   `telegram_message_id`) or schedules a retry with exponential backoff (1 m, 5 m, 30 m, then
   `failed`). Telegram 429 `retry_after` is honoured and does not count as an attempt; a
   recipient who blocked the bot (403) is `failed` at once.
3. Chat throttle (N9): `dedupe_key = 'chat:<reservationId>:<memberId>'`. Enqueue is skipped if a
   row with that key exists and the member has not read the thread since (`thread_reads`).
   Reading the thread (`POST …/read`) deletes the key so the next burst notifies again.
4. Quick actions edit the original notification message after use ("✅ Confirmed") to make
   stale buttons visibly stale.

## 9. Jobs

| Job | Schedule | What it does |
|---|---|---|
| `notifications.dispatch` | every 2 s | §8 step 2. |
| `reservations.remind` | every 5 min | N7 for pending reservations entering the reminder window. |
| `reservations.expire` | every 5 min | Expire pending reservations past `expires_at`. |
| `offers.expire` | daily 00:05 Europe/Madrid + on boot | Expire offers whose `available_until` < today. |
| `offers.nudge` | daily 09:00 Europe/Madrid | Nudge / mark stale / re-nudge weekly, per PRD US-3.4. |
| `catalog.sync` | hourly at :07 + on boot if never synced | §10. Also triggered by admin *Sync now* and `/sync`. |

Jobs are plain async functions `(deps) => Promise<JobReport>`, registered with the scheduler,
each wrapped in a mutex so overlapping runs are skipped, each logging a one-line report.

## 10. Catalogue sync

```
fetchRows()  ──►  normalizeHeaders()  ──►  parseRow() ×N  ──►  applyDiff() in one tx  ──►  log
 (sheets|csv)      (ca/es/en aliases)      (zod, unit map,      upsert by slug,
                                             price parse)        archive missing,
                                                                 resolve pending,
                                                                 price-resolve reservations
```

- `slug = name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ')`.
- A content hash of fetched rows is stored on the sync row. Identical content with no pending
  match or other catalogue drift skips product writes; each attempt still logs its result.
  Invalid rows keep the report `partial`; warnings/errors remain visible.
- Sync, proposal and pending-product actions serialize with one transaction advisory lock.
  Fetch runs under that lock so a slower, older fetch cannot overwrite a later result.
  Manual/command sync checks the actor before fetching and again before applying changes.
- Validation diagnostics persist reason codes, row numbers (0 for source-wide failures), and
  severity, translated by the UI. Source failures never expose credentials or source bodies.
- M2 provides transaction hooks for pending resolution, merge and rejection. M3 wires offer
  references; M4 wires reservation snapshots/cancellation. Until then, attempting a destructive
  action on a referenced proposal fails safely rather than deleting downstream records.
- Zero valid rows → `failed`, nothing applied, N12 to admins.
- Sheets mode: `GOOGLE_SERVICE_ACCOUNT_JSON` (base64 of the key file), `GOOGLE_SHEET_ID`,
  `GOOGLE_SHEET_RANGE` (default `Productes!A:E`). The sheet must be shared read-only with the
  service account email. CSV mode: `CATALOG_CSV_URL` of a "publish to web → CSV" link.

## 11. API

All under `/api`, JSON, auth as §4. Contracts are zod schemas in
`packages/shared/src/contracts/<area>.ts`; the table is the index, the schemas are the truth.

| Method & path | Guard | Purpose |
|---|---|---|
| `GET /me` | any auth | Member profile incl. `status`, `role`, `language`, unread counts, `settings` subset needed by the UI. |
| `PATCH /me` | member | `language`, `display_name`. |
| `GET /board?group=product\|producer&q=&category=` | member | Reservable offers of others. |
| `GET /products?q=&includePending=1` | member | Picker: active products + my pending ones. |
| `POST /products/proposals` | member | `{name, unitCode}` → pending product. |
| `GET /offers/mine` | member | My offers with `held`, `available`, open reservation counts. |
| `POST /offers` | member | `{productId, quantity, availableUntil?, note?}`. 409 if active offer exists for that product (returns it). |
| `PATCH /offers/:id` | producer | quantity / date / note; 422 `OFFER_QUANTITY_BELOW_HELD`. |
| `POST /offers/:id/withdraw` | producer | |
| `POST /offers/:id/still-available` | producer | Reset nudge counter. |
| `GET /offers/:id` | member | Detail (for deep links). |
| `POST /reservations` | member | `{offerId, quantity}`; 409 `INSUFFICIENT_AVAILABILITY {available}`. |
| `GET /reservations?side=incoming\|outgoing&state=active\|closed` | member | |
| `GET /reservations/:id` | party | Reservation + offer + product + counterpart summary. |
| `POST /reservations/:id/confirm` · `/reject` · `/cancel` · `/deliver` | party (per §6) | `{reason?}` for reject/cancel. |
| `GET /reservations/:id/messages?after=<id>` | party | Paginated thread. |
| `POST /reservations/:id/messages` | party | `{body}`. 403 `THREAD_READONLY` when closed too long. |
| `POST /reservations/:id/read` | party | Mark read up to latest. |
| `POST /reservations/:id/presence` | party | `{viewing: boolean}`. |
| `GET /events` | member | SSE. |
| `GET /admin/members?status=` | admin | |
| `POST /admin/members/:id/approve` · `/reject` · `/suspend` · `/reinstate` · `/promote` · `/demote` | admin | Guards for last admin. |
| `GET/POST/DELETE /admin/invites` | admin | Pre-approvals. |
| `GET /admin/catalog` | admin | Last syncs, counts, pending products, sheet link. |
| `POST /admin/catalog/sync` | admin | Run sync now, return report. |
| `POST /admin/products/:id/rename` · `/reject` | admin | Pending products only. |
| `GET/PATCH /admin/settings` | admin | Validated per key. |

### Error handling
Every error response is `{ error: { code, message, details? } }` where `code` is a member of
`ErrorCode` in `packages/shared/src/enums.ts` and `message` is already localized in the
member's language. HTTP status follows the code (400 validation, 401 auth, 403 forbidden /
gate, 404, 409 conflict, 422 domain rule, 500). Unknown errors are logged with the request id
and returned as `INTERNAL` with that id so users can report it. The Mini App shows a toast
for every non-2xx.

## 12. Mini App

Screens (routes):

| Route | Screen |
|---|---|
| `/gate` | Applicant / rejected / suspended states, per `GET /me`. Everything else redirects here when not approved. |
| `/` | Board: search, group toggle, category chips, list → offer detail sheet with reserve form. |
| `/offers` | My offers: list with held/available; publish button → product picker (search, propose) → form; edit/withdraw. |
| `/reservations` | Incoming / outgoing × active / closed. |
| `/reservations/:id` | Thread with context header and actions. |
| `/settings` | Language, display name, version. |
| `/admin/members`, `/admin/catalog`, `/admin/settings` | Admin tab (visible if `role === 'admin'`). |

Behaviour:
- Bottom navigation: Board · My offers · Reservations (badge) · Settings · Admin (if admin).
- Telegram theme via `themeParams` → CSS variables; `MainButton` used for the primary action of
  forms (publish, reserve, send); `BackButton` wired to router; haptic feedback on actions.
- Data layer: small fetch wrapper adding the `tma` header; per-screen stores with `refetch()`;
  SSE store dispatches refetches. Optimistic UI only for sending chat messages.
- i18n: `t(key, params)` from `packages/shared`, current language from `/me`; falls back to the
  Telegram `language_code` before `/me` resolves. Numbers/dates via `Intl` with
  `Europe/Madrid`.

## 13. Configuration

| Variable | Required | Notes |
|---|---|---|
| `BOT_TOKEN` | yes | AgroBot 1.0's existing token (ADR-0013). 1.0 must be stopped before 2.0 uses it — one token, one consumer. |
| `BOT_USERNAME`, `MINIAPP_SHORT_NAME` | yes | For deep links. `BOT_USERNAME` is 1.0's; the Mini App short name is created in @BotFather on the same bot. |
| `BOT_MODE` | no | `webhook` (default) or `polling` (dev). |
| `PUBLIC_URL` | yes in webhook mode | HTTPS base; webhook is `PUBLIC_URL/telegram/webhook`. |
| `TELEGRAM_WEBHOOK_SECRET` | yes in webhook mode | Random 32+ chars. |
| `DATABASE_URL` | yes | Postgres connection string. |
| `ADMIN_TELEGRAM_IDS` | yes (first deploy) | Comma-separated; auto-approved as admins on `/start`. |
| `CATALOG_SOURCE` | yes | `sheets` or `csv`. |
| `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_RANGE`, `GOOGLE_SERVICE_ACCOUNT_JSON` | sheets mode | Range defaults to `Productes!A:E` (PRD §6). Key is base64; the sheet is shared read-only with that service account. |
| `CATALOG_CSV_URL` | csv mode | |
| `DEFAULT_LOCALE` | no | `ca`. |
| `TZ` | no | `Europe/Madrid` (display only; storage is UTC). |
| `PORT` | no | 8080. |
| `LOG_LEVEL` | no | `info`. |
| `SENTRY_DSN` | no | Enables error tracking. |
| `DEV_AUTH_BYPASS_TELEGRAM_ID` | dev only | Ignored in production. |

`env.ts` validates all of this with zod at boot and exits with a readable list of problems.

## 14. Local development

```bash
pnpm install
docker compose up -d            # Postgres on 5432
cp .env.example .env            # fill BOT_TOKEN etc.
pnpm db:migrate && pnpm db:seed # units, settings, dev members
pnpm dev                        # server (tsx watch, BOT_MODE=polling) + miniapp (vite)
```
- Mini App outside Telegram: open `http://localhost:5173`, the dev auth bypass signs you in as
  `DEV_AUTH_BYPASS_TELEGRAM_ID`. A dev-only switcher lets you impersonate any seeded member to
  test both sides of a reservation in two browser tabs.
- Inside Telegram: `cloudflared tunnel --url http://localhost:8080` (or ngrok), set
  `PUBLIC_URL`, switch `BOT_MODE=webhook`, point the Mini App URL in @BotFather at the tunnel.

## 15. Build, CI, deployment

- `Dockerfile` (multi-stage): install with pnpm → build `shared`, `miniapp`, `server` → copy
  `miniapp/dist` into `server/public` → runtime image `node:22-alpine`, `node dist/index.js`.
  Migrations run on boot (`drizzle-orm/migrator`) before the HTTP server listens.
- CI (`.github/workflows/ci.yml`) on every PR and on `main`: `pnpm lint`, `pnpm typecheck`,
  `pnpm test` (unit + integration with a Postgres service container), `pnpm build`,
  `pnpm e2e` (Playwright against the built server with dev auth bypass and a seeded DB).
- Deploy: container to **Railway** (`railway.json` in repo) with **Railway Postgres**; secrets as
  Railway service variables, `PUBLIC_URL` from the service domain (ADR-0012). Daily managed
  backups; the restore drill in M6 proves them. Nothing in the image is Railway-specific, so any
  provider that runs a container and gives an HTTPS URL remains a working target.
- Release: tag `v2.x.y`; `/status` shows the version from `package.json` + git SHA baked at
  build time.

## 16. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Domain unit | Vitest | State machine guards and transitions, availability math, unit step validation, slug normalization, sheet row parsing, notification throttle logic. Ports mocked. |
| Integration | Vitest + real Postgres | Every API route through Hono's `app.request()`; concurrency test: two parallel reservations for the last quantity, exactly one succeeds; jobs against seeded data with a fake clock. |
| Bot | Vitest + grammY test transformer | `/start` paths (applicant, pre-approved, admin bootstrap), quick actions incl. stale ones. |
| Mini App | Vitest + Testing Library | Components with i18n and both languages; reserve form validation per unit. |
| E2E | Playwright | Two browser contexts (producer, requester): publish → appears on board → reserve → confirm → chat both ways → deliver. Admin approve flow. Runs in CI. |
| i18n | build step | Script fails if `ca.json` and `es.json` keys differ or a key used in code is missing. |

## 17. Security checklist

- initData validation with constant-time compare; reject when `hash` missing or `auth_date`
  stale; never trust `user` fields from the client body.
- Webhook secret header check; reject other methods/paths from Telegram IP ranges not needed.
- All authorization inside domain services (not only in routes) so quick actions and API share it.
- Rate limit `POST /api/*` per member (e.g. 60/min) and messages per thread (20/min).
- Body size limits; message length limits; HTML-escape everything we send to Telegram
  (`parse_mode: 'HTML'`, one escape helper, unit-tested).
- Secrets only from env; `.env` git-ignored; `env.ts` never logs values.
- Dependencies pinned via lockfile; `pnpm audit` in CI as non-blocking report.
