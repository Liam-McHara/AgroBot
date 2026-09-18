# AgroBot 2.0 — Architecture

_Technical design that implements [prd.md](prd.md). Decisions with alternatives are recorded
in [adr/](adr/README.md); this document states what we build and how the pieces fit._

## 1. Overview

```
                    Telegram servers                      Mini App web view
                 ┌─────────┴──────────┐                   (HTTPS + WebSocket)
        webhook  │                    │                          │
        (bot)    ▼                    ▼                          ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  apps/server on Cloudflare Workers: one Worker + one Durable Object       │
│                                                                           │
│  Worker `fetch` (Hono; request-scoped; 10 ms CPU)                         │
│   ├─ POST /telegram/webhook    → grammY bot (commands, quick actions)     │
│   ├─ /api/*                    → REST JSON for the Mini App               │
│   ├─ POST /api/events/ticket · GET /api/events → WebSocket, to the hub    │
│   ├─ GET /health                                                          │
│   └─ everything else           → Mini App build (Static Assets, free)     │
│                                                                           │
│  Durable Object `AgroBotHub` (one instance; SQLite storage; 30 s CPU)     │
│   ├─ alarm(): jobs when due — outbox dispatch · reservation reminders and │
│   │           expiry · offer expiry and nudges · catalogue sync           │
│   └─ WebSocket hub (hibernating sockets tagged by member) · presence ·    │
│       rate counters                                                       │
│                                                                           │
│  Domain services (pure TS) ── Drizzle ORM ── Hyperdrive ──► Neon Postgres │
└───────────────────────────────────────────────────────────────────────────┘
                              │
                 Google Sheets API (service account, fetch + WebCrypto JWT)
                 or published CSV URL
```

One deployable unit (`wrangler deploy`), all on free plans (ADR-0016). No queue, no cache
server, no process to keep alive. A request handler does one member's work; anything longer
(a fan-out, the catalogue sync) runs in the hub, the only long-lived thing (ADR-0017). Scaling
beyond one hub instance is out of scope, as one process was before.

## 2. Repository layout (pnpm workspace)

```
.
├── apps/
│   ├── server/                 # Hono + grammY + Drizzle + jobs
│   │   ├── src/
│   │   │   ├── worker.ts       # Worker entry: fetch → Hono app; exports the AgroBotHub class
│   │   │   ├── env.ts          # zod-validated bindings (vars, secrets, Hyperdrive)
│   │   │   ├── db/             # drizzle schema, migrations, client, seeds
│   │   │   ├── domain/         # one folder per aggregate: members, catalog, offers,
│   │   │   │                   #   reservations, threads, notifications, settings
│   │   │   │                   #   (services + state machines, no HTTP/Telegram code)
│   │   │   ├── http/           # Hono app, middlewares (auth, errors, logging), routes
│   │   │   ├── bot/            # grammY: commands, callback (quick action) handlers,
│   │   │   │                   #   notifications/ (renderers per kind), deep links
│   │   │   ├── jobs/           # job functions + next-due math; the hub calls them
│   │   │   ├── integrations/   # google-sheets.ts (fetch + WebCrypto), csv-catalog.ts, telegram-api.ts
│   │   │   ├── realtime/       # hub.ts: the Durable Object (schedule, sockets, presence, counters)
│   │   │   └── i18n/           # server-side t() bound to member language
│   │   ├── test/               # integration tests (real Postgres)
│   │   └── wrangler.jsonc      # Worker config: assets, Hyperdrive, DO, cron, vars (ADR-0016)
│   └── miniapp/                # Svelte 5 + Vite, Telegram Mini App SDK
│       ├── index.html          # Vite entry point (plain SPA, not SvelteKit)
│       └── src/
│           ├── main.ts         # mounts App.svelte, initialises Telegram and i18n
│           ├── lib/api/        # typed client generated from shared contracts
│           ├── lib/i18n/
│           ├── lib/stores/     # me, board, reservations, realtime (one WebSocket)
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
├── scripts/                    # i18n check, Postgres init, dev Telegram forwarder, set-webhook
├── docker-compose.yml          # local Postgres (development and tests only)
├── .github/workflows/ci.yml    # checks on every PR; deploy job on main (§15)
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js
└── AGENTS.md, README.md, .env.example
```

Rules of dependency: `miniapp` and `server` depend on `shared`; nothing depends on `legacy`.
`domain/` never imports from `http/`, `bot/` or `integrations/`; it receives ports (db
transaction, clock, notifier, event bus) as parameters so it is unit-testable.

## 3. Runtime and libraries

| Concern | Choice | Notes |
|---|---|---|
| Runtime | **Cloudflare Workers** (workerd), ESM, TypeScript strict | `wrangler dev` locally, `wrangler deploy` to production; `nodejs_compat` flag for the `node:crypto` / `node:buffer` the code uses. Node 22 stays the toolchain: pnpm, tsc, vitest, drizzle-kit, the CLI scripts. |
| HTTP | **Hono** | Native on Workers; `zod-validator` for bodies. Runtime-agnostic, which is what lets integration tests drive it with `app.request()`. |
| Bot | **grammY** | `webhookCallback(bot, "hono")` on `POST /telegram/webhook`. No polling mode: in development `scripts/dev-telegram.mjs` long-polls Telegram with the throwaway token and posts each update to the local webhook (§14). Plugins: `auto-retry` transformer for 429s; `@grammyjs/i18n` not used (we share our own catalogue). |
| DB | **Postgres 16 on Neon** (free plan) + **Drizzle ORM** | Driver `postgres` (postgres.js) over a **Hyperdrive** binding: one client per invocation, closed in `waitUntil`. `drizzle-kit` migrations committed in `apps/server/src/db/migrations`, applied from CI (§15). |
| Jobs and realtime | **Durable Object `AgroBotHub`** | One SQLite-backed instance: alarm-driven schedule, hibernating WebSockets, presence, rate counters (ADR-0017, §7, §9). |
| Static files | **Workers Static Assets** | The Mini App build; `not_found_handling: single-page-application`, `run_worker_first` for `/api/*`, `/telegram/*`, `/health`. Free and unlimited; costs no Worker CPU. |
| Validation | **zod** in `packages/shared` | Single source for API contracts; server validates, client infers types. |
| Frontend | **Svelte 5 + Vite**, `@telegram-apps/sdk` | Router: `svelte-spa-router` (hash routes), decided in M1: a plain SPA with no framework server side, fewer moving parts than SvelteKit. |
| Realtime transport | WebSocket | Native `WebSocket` in the Mini App with reconnect and backoff; hibernated in the hub (§7). |
| Google Sheets | `fetch` + WebCrypto (RS256 JWT for the service account) | `googleapis` does not run on workerd. Fallback mode: fetch a published-CSV URL and parse with `csv-parse`. |
| Logging | JSON `console.log` wrapper with request ids | Ingested by Workers Logs (200 000 events/day, 3 days on the Free plan). `@sentry/cloudflare` when `SENTRY_DSN` is set. |
| Tests | **Vitest** (unit; integration against real Postgres; the hub under `@cloudflare/vitest-pool-workers`), **Playwright** (e2e against `wrangler dev`), `@testing-library/svelte` | Integration tests run against the docker-compose Postgres (CI: service container). |
| Lint/format | ESLint (typescript-eslint, svelte plugin) + Prettier | `pnpm lint` in CI. |
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
- Webhook URL `POST /telegram/webhook`, registered by `pnpm bot:set-webhook`
  (`scripts/set-webhook.mjs`, idempotent; run by the deploy workflow and by hand for tunnels)
  with `secret_token = TELEGRAM_WEBHOOK_SECRET`; grammY checks the header on every update.
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
| create | requester | offer reservable, quantity ≤ available (row lock), requester ≠ producer | snapshot price, `expires_at`, N6, system line "reserved", realtime `reservation.changed` + `board.changed` |
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
`pending → active` (sync match), or `pending → archived` when renamed to an existing active
sheet product (references transfer to that product; ADR-0015), `pending → (deleted)` on admin
reject (offers withdrawn, reservations cancelled), `active ⇄ archived` by sync.

## 7. Realtime (WebSocket through the hub)

- The Mini App calls `POST /api/events/ticket` (auth as §4) and receives a random, single-use
  ticket valid for 30 s, stored in the hub's SQLite. It then opens
  `GET /api/events?ticket=<ticket>` as a WebSocket. A browser cannot set headers on a WebSocket
  and `initData` must not travel in a URL; the ticket carries the member id instead.
- The Worker checks the `Origin` header against `PUBLIC_URL` and forwards the upgrade to the
  hub, which redeems the ticket and accepts the socket with the **Hibernation API**, tagged by
  member id. An idle socket costs no duration; the hub is asleep between events.
- Events are JSON frames named as before: `board.changed {}`, `reservation.changed {id}`,
  `message.new {reservationId, message}`, `me.changed {}`. Keep-alives use the platform's
  auto-response so a ping does not wake the object.
- Domain services emit events through a `DomainEvents` port after the transaction commits. The
  Worker's subscriber calls `hub.publish(memberIds, event)` (one RPC per commit, in
  `waitUntil`) and the hub writes the frame to every socket tagged with those members. The
  notification enqueuer is another subscriber, unchanged.
- Presence: the client sends `{viewing: reservationId | null}` when it opens or leaves a
  thread; the hub stores it as the socket's attachment. `hub.isViewing(memberId, reservationId)`
  is what the chat notification throttle (§8) asks before enqueuing N9. There is no HTTP
  endpoint for presence.
- Clients react by refetching the affected query (board, reservation, thread); no client-side
  reconciliation. The realtime store reconnects with exponential backoff (1 s … 30 s) and
  refetches everything on reconnect, so a missed frame costs one extra request, never a stale
  screen.

## 8. Notifications (outbox)

1. Domain code inserts a `notifications` row **in the same transaction** as the state change
   (`kind`, `member_id`, `payload`, optional `dedupe_key`).
2. After the commit, the request calls `hub.wake()` (in `waitUntil`). The hub's
   `notifications.dispatch` job runs within a second: `SELECT … WHERE status='queued' AND
   next_attempt_at <= now() ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`, renders
   text + inline keyboard in the recipient's language, calls `sendMessage`, marks `sent`
   (stores `telegram_message_id`) or schedules a retry with exponential backoff (1 m, 5 m,
   30 m, then `failed`). Telegram 429 `retry_after` is honoured and does not count as an
   attempt; a recipient who blocked the bot (403) is `failed` at once. If the batch was full
   the hub re-arms itself immediately; otherwise its next alarm for this job is
   `min(next_attempt_at)` of what remains queued. Batches of 20 stay under the 50 subrequests
   a free-plan invocation may make, so a group-wide N3 to a hundred members is five alarm runs
   and a few seconds.
3. Chat throttle (N9): `dedupe_key = 'chat:<reservationId>:<memberId>'`. Enqueue is skipped if a
   row with that key exists and the member has not read the thread since (`thread_reads`), or
   if `hub.isViewing(memberId, reservationId)` says the recipient has the thread open (§7).
   Reading the thread (`POST …/read`) deletes the key so the next burst notifies again.
4. Quick actions edit the original notification message after use ("✅ Confirmed") to make
   stale buttons visibly stale.

## 9. Jobs

Jobs are plain async functions `(deps) => Promise<JobReport>` in `jobs/`, each idempotent
(status guards, `reminded_at`, `nudged_at`, content hashes) because alarms are at-least-once.
Production has exactly one caller: the hub's `alarm()` (ADR-0017). It keeps a
`schedule(job, due_at)` table in its SQLite, runs whatever is due, stores each job's next
`due_at`, and sets the single alarm to the earliest one. Tests call the functions directly.

| Job | Next `due_at` | What it does |
|---|---|---|
| `notifications.dispatch` | *now* on `hub.wake()` after a commit that enqueued; else `min(next_attempt_at)` of queued rows | §8 step 2, batches of 20. |
| `reservations.remind` | `min(expires_at − reminder)` over pending, un-reminded reservations | N7 for pending reservations entering the reminder window. |
| `reservations.expire` | `min(expires_at)` over pending reservations | Expire pending reservations past `expires_at`. |
| `offers.expire` | next 00:05 Europe/Madrid | Expire offers whose `available_until` < today. |
| `offers.nudge` | next 09:00 Europe/Madrid | Nudge / mark stale / re-nudge weekly, per PRD US-3.4. |
| `catalog.sync` | next minute 7 of an hour; also on demand | §10. Admin *Sync now* and `/sync` call `hub.runJob('catalog.sync')` and await its report. |

Rules:
- Deadline jobs read their next `due_at` from Postgres only during a run, while the database is
  already awake, and the Worker calls `hub.wake()` after any transaction that creates or moves
  a deadline (a new reservation, a confirmed one, an enqueued notification), so the alarm is
  never later than the work.
- **Nothing polls Postgres on a timer.** A five-minute sweep would keep Neon awake all month
  (ADR-0016). A Cron Trigger every 15 minutes calls `hub.ensureArmed()`, which reads only the
  hub's own storage and re-arms the alarm if it is missing; it is a liveness check, not a
  scheduler.
- Periodic jobs compute the next local occurrence with `Intl.DateTimeFormat` in Europe/Madrid,
  so DST is handled and 00:05 means 00:05 on the farm.
- A job that throws is logged with its name and report; the platform retries the alarm with
  backoff, and the other jobs' `due_at` rows are untouched.

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
  service account email. The client signs an RS256 JWT with WebCrypto, exchanges it for an
  access token and calls the Sheets REST API with `fetch` (no `googleapis`, which needs Node).
  CSV mode: `CATALOG_CSV_URL` of a "publish to web → CSV" link.
- The sync runs in the hub (30 s of CPU), never in a request handler; a manual sync awaits the
  hub's report and returns it.

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
| `POST /events/ticket` | member | Single-use 30 s ticket for the realtime socket (§7). |
| `GET /events?ticket=` | member (via ticket) | WebSocket upgrade, handed to the hub. Presence is a socket message, not an endpoint (§7). |
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
  the realtime store (one WebSocket, §7) dispatches refetches. Optimistic UI only for sending
  chat messages.
- i18n: `t(key, params)` from `packages/shared`, current language from `/me`; falls back to the
  Telegram `language_code` before `/me` resolves. Numbers/dates via `Intl` with
  `Europe/Madrid`.

## 13. Configuration

Production configuration lives on the Worker: plain values as `vars` in `wrangler.jsonc`,
secrets set once with `wrangler secret put`, and bindings (Hyperdrive, the hub, static assets)
declared in the same file. Development uses one `.env` at the repository root, which
`wrangler dev`, Vite (`VITE_*` keys) and the CLI scripts all read. `env.ts` validates the
merged object with zod at the start of every invocation and fails the request with a readable
list of problems; nothing is ever logged by value.

| Variable | Where | Required | Notes |
|---|---|---|---|
| `BOT_TOKEN` | secret | yes | AgroBot 1.0's existing token (ADR-0013). 1.0 must be stopped before 2.0 uses it — one token, one consumer. |
| `TELEGRAM_WEBHOOK_SECRET` | secret | yes | Random 32+ chars; checked on every webhook update. |
| `BOT_USERNAME`, `MINIAPP_SHORT_NAME` | var | yes | For deep links. `BOT_USERNAME` is 1.0's; the Mini App short name is created in @BotFather on the same bot. |
| `PUBLIC_URL` | var | yes | HTTPS base of the Worker (`https://<name>.<account>.workers.dev` or the custom domain). The webhook is `PUBLIC_URL/telegram/webhook`; also the accepted `Origin` for sockets. |
| `HYPERDRIVE` | binding | yes | Hyperdrive configuration pointing at Neon's pooled connection string; `env.HYPERDRIVE.connectionString` is what the driver opens. |
| `DATABASE_URL` | `.env` / CI secret | CLI only | Direct Postgres URL for `db:migrate`, `db:seed`, `db:generate` and the integration tests (`TEST_DATABASE_URL`). In development it is also the local Hyperdrive target (`WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`). Never a Worker var. |
| `ADMIN_TELEGRAM_IDS` | var | yes (first deploy) | Comma-separated; auto-approved as admins on `/start`. |
| `CATALOG_SOURCE` | var | yes | `sheets` or `csv`. |
| `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_RANGE` | var | sheets mode | Range defaults to `Productes!A:E` (PRD §6). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | secret | sheets mode | Base64 of the key file; the sheet is shared read-only with that service account. |
| `CATALOG_CSV_URL` | var | csv mode | |
| `NODE_ENV` | var | no | `production` on the Worker, `development` in `.env`, `test` in tests. Gates the dev auth bypass. |
| `DEFAULT_LOCALE` | var | no | `ca`. |
| `TZ` | var | no | `Europe/Madrid` (display only; storage is UTC). |
| `LOG_LEVEL` | var | no | `info`. |
| `GIT_COMMIT` | var | no | Set by the deploy workflow (`--var GIT_COMMIT:<sha>`) for `/status` and `/health`. |
| `SENTRY_DSN` | secret | no | Enables error tracking. |
| `DEV_AUTH_BYPASS_TELEGRAM_ID` | `.env` only | dev only | Refused when `NODE_ENV=production`. |

Gone with the always-on process: `BOT_MODE` (webhook only), `PORT` (`wrangler dev --port 8080`
keeps the Vite proxy unchanged) and `LOG_PRETTY`.

## 14. Local development

```bash
pnpm install
docker compose up -d            # Postgres on 5432 (+ agrobot_test)
cp .env.example .env            # fill BOT_TOKEN (a throwaway bot) etc.
pnpm db:migrate && pnpm db:seed # units, settings, dev members
pnpm dev                        # wrangler dev (Worker + hub, :8080) + miniapp (vite, :5173)
                                # + scripts/dev-telegram.mjs (feeds the local webhook)
```
- `wrangler dev` runs the real runtime locally (workerd): the Worker, the hub with its alarms
  and sockets, static assets from `apps/miniapp/dist` when present, and a local Hyperdrive that
  points at Docker Postgres. It reads `.env`, so there is one configuration file.
- The bot has no polling mode. `scripts/dev-telegram.mjs` deletes the throwaway bot's webhook,
  long-polls `getUpdates` with `BOT_TOKEN`, and POSTs every update to
  `http://localhost:8080/telegram/webhook` with the secret header. The webhook handler is the
  only bot code path, in development as in production.
- Mini App outside Telegram: open `http://localhost:5173`, the dev auth bypass signs you in as
  `DEV_AUTH_BYPASS_TELEGRAM_ID`. A dev-only switcher lets you impersonate any seeded member to
  test both sides of a reservation in two browser tabs.
- Inside Telegram: `cloudflared tunnel --url http://localhost:8080`, set `PUBLIC_URL` to the
  tunnel, run `pnpm bot:set-webhook` (stop the forwarder first: a bot has either a webhook or
  `getUpdates`, never both), and point the Mini App URL in @BotFather at the tunnel.

## 15. Build, CI, deployment

- **Build.** `pnpm build` builds `shared` (tsc), the Mini App (Vite, into `apps/miniapp/dist`,
  which `wrangler.jsonc` declares as the assets directory) and validates the Worker bundle
  (`wrangler deploy --dry-run --outdir dist`). Wrangler bundles `src/worker.ts` with esbuild;
  the migrations folder is not shipped, it is applied from CI.
- **CI** (`.github/workflows/ci.yml`) on every PR and on `main`: `pnpm lint`, `pnpm typecheck`,
  `pnpm test` (unit + integration with a Postgres service container + hub tests under
  `vitest-pool-workers`), `pnpm build`, `pnpm e2e` (Playwright against `wrangler dev` with the
  local Hyperdrive on `agrobot_test`, the dev auth bypass and a seeded DB). GitHub Actions is
  free for this public repository.
- **Deploy** (`deploy` job in the same workflow, on `main` after the checks pass):
  1. `pnpm db:migrate` against Neon (`DATABASE_URL` repository secret; forward-only).
  2. `wrangler deploy --var GIT_COMMIT:$GITHUB_SHA` (`CLOUDFLARE_API_TOKEN`,
     `CLOUDFLARE_ACCOUNT_ID`).
  3. `pnpm bot:set-webhook` (`BOT_TOKEN`, `PUBLIC_URL`, `TELEGRAM_WEBHOOK_SECRET`), idempotent.

  Secrets on the Worker are set once with `wrangler secret put`; vars live in `wrangler.jsonc`.
  A staging Worker (`agrobot-staging`, its own Neon branch and a throwaway bot) takes the same
  workflow from a `staging` branch.
- **Rollback.** `wrangler rollback` restores the previous Worker version in seconds. Migrations
  are never rolled back; write a compensating migration.
- **Backups.** Neon point-in-time restore, six hours on the free plan (ADR-0016). Restoring is
  creating a branch at a timestamp and re-pointing Hyperdrive at it; the M6 drill does exactly
  that against staging. There is no off-site copy (backlog item 1).
- **Free-plan budget** (per day unless stated), with the expected load for a hundred members:

  | Cap | Free plan | Expected | Where it is spent |
  |---|---|---|---|
  | Worker requests | 100 000 | < 10 000 | API calls and webhooks; assets do not count |
  | Worker CPU | 10 ms per request | 1–3 ms | Hono + zod + Drizzle per request |
  | Hub requests | 100 000 | < 5 000 | `wake`, `publish`, tickets, alarms, socket frames |
  | Hub duration | 13 000 GB-s | < 1 000 | alarm runs; hibernated sockets are free |
  | Hyperdrive queries | 100 000 | < 20 000 | every statement, requests and jobs alike |
  | Neon compute | 100 CU-hours per month | 20–40 | awake only during requests and due jobs |
  | Neon storage | 0.5 GB | < 50 MB | |

  Past a cap the platform returns errors until midnight UTC, so the runbook checks these
  weekly, and the Workers Paid plan ($5/month) is the escape hatch if any column ever passes
  a quarter of its cap.
- **Release.** Tag `v2.x.y`; `/status` shows the version from `package.json` + the git SHA
  passed at deploy time.

## 16. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Domain unit | Vitest | State machine guards and transitions, availability math, unit step validation, slug normalization, sheet row parsing, notification throttle logic. Ports mocked. |
| Integration | Vitest + real Postgres | Every API route through Hono's `app.request()`; concurrency test: two parallel reservations for the last quantity, exactly one succeeds; jobs against seeded data with a fake clock. |
| Bot | Vitest + grammY test transformer | `/start` paths (applicant, pre-approved, admin bootstrap), quick actions incl. stale ones. |
| Hub | Vitest under `@cloudflare/vitest-pool-workers` | Next-due math (Madrid local time, DST), alarm re-arming, ticket issue/redeem/expiry, socket tagging and publish fan-out, rate counters. Jobs are mocked here; they have their own integration tests. |
| Mini App | Vitest + Testing Library | Components with i18n and both languages; reserve form validation per unit. |
| E2E | Playwright against `wrangler dev` | Two browser contexts (producer, requester): publish → appears on board → reserve → confirm → chat both ways → deliver. Admin approve flow. Runs in CI. |
| i18n | build step | Script fails if `ca.json` and `es.json` keys differ or a key used in code is missing. |

## 17. Security checklist

- initData validation with constant-time compare; reject when `hash` missing or `auth_date`
  stale; never trust `user` fields from the client body.
- Webhook secret header check; reject other methods/paths from Telegram IP ranges not needed.
- All authorization inside domain services (not only in routes) so quick actions and API share it.
- Rate limit mutating `/api/*` calls per member (e.g. 60/min) and messages per thread (20/min)
  with counters in the hub's SQLite (one instance, exact counts).
- Socket tickets are random (128 bits), single-use, 30 s; the upgrade checks `Origin` against
  `PUBLIC_URL`; `initData` never appears in a URL or a log.
- Body size limits; message length limits; HTML-escape everything we send to Telegram
  (`parse_mode: 'HTML'`, one escape helper, unit-tested).
- Secrets only as Worker secrets (`wrangler secret put`) or the local `.env`; never in
  `wrangler.jsonc` or the repository; `env.ts` never logs values.
- Dependencies pinned via lockfile; `pnpm audit` in CI as non-blocking report.
