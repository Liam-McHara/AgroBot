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
│   │   │   ├── realtime/       # hub.ts: the Durable Object (schedule, sockets, presence, counters);
│   │   │   │                   #   port.ts (what the Worker asks of it), client.ts (over the stub)
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
├── e2e/                        # Playwright suite against wrangler dev (§15)
├── legacy/                     # AgroBot 1.0, frozen
├── scripts/                    # i18n check, Postgres init, wrangler dev wrapper (+ lib/), dev
│                               #   Telegram forwarder, set-webhook
├── docker-compose.yml          # local Postgres (development and tests only)
├── .github/workflows/ci.yml    # checks on every PR; deploy job on main and staging (§15)
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js
└── CLAUDE.md, README.md, .env.example
```

Rules of dependency: `miniapp` and `server` depend on `shared`; nothing depends on `legacy`.
`domain/` never imports from `http/`, `bot/`, `integrations/` or `realtime/` (ESLint enforces
it); it receives ports (db transaction, clock, the hub as `domain/ports.ts`) as parameters so
it is unit-testable.

## 3. Runtime and libraries

| Concern | Choice | Notes |
|---|---|---|
| Runtime | **Cloudflare Workers** (workerd), ESM, TypeScript strict | `wrangler dev` locally on the committed `wrangler.jsonc`; `pnpm deploy:worker` from CI, which generates the deploy configuration from environment variables (§13, §15); `nodejs_compat` flag for the `node:crypto` / `node:buffer` the code uses. Targeted placement puts the Worker next to Neon (`aws:eu-central-1`), and the hub is created with the `weur` location hint. Node 22 stays the toolchain: pnpm, tsc, vitest, drizzle-kit, the CLI scripts. |
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
| Tests | **Vitest** (unit; integration against real Postgres; the hub under `@cloudflare/vitest-plugin`, inside workerd), **Playwright** (e2e against `wrangler dev`), `@testing-library/svelte` | Integration tests run against the docker-compose Postgres (CI: service container). The Cloudflare plugin requires Vitest 4, so the server pins it while the other packages are on 5. |
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
  to show, and `POST /api/events/ticket`, so the gate hears of an approval as `me.changed` on
  the socket (§7) instead of polling `/me` on a timer; everything else answers 403 with
  `NOT_APPROVED` or `SUSPENDED`. The guards call
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
- Quick-action callbacks carry `action:entityId` in `callback_data` (≤ 64 bytes):
  `approve`/`reject:<memberId>` (N1), `still`/`withdraw:<offerId>` (N10),
  `confirm`/`refuse:<reservationId>` (N6, N7; the reservation's *Reject* is `refuse` on the wire
  because `reject` already names the applicant's). Handlers resolve the member from `from.id`
  and call the same domain service the API would call, so permission checks are shared.

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
- `unread(member, reservation) = count of messages WHERE kind='text' AND sender_id ≠ member AND
  created_at > created_at of thread_reads.last_read_message_id` (or `last_read_at` when the
  marker points nowhere), over the reservations the member is a party of and *My reservations*
  lists (active, or closed in the last 30 days), so a badge never points at a row that is not
  there. System lines never count: N8 already told the member.

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
| create | requester | offer reservable, quantity ≤ available (offer row locked first, `held` read in a second statement so it sees every reservation committed meanwhile), requester ≠ producer | snapshot price, `expires_at`, N6, system line "created", realtime `reservation.changed` + `board.changed`, `hub.wake()` for the deadline |
| confirm | producer | pending | clear `expires_at`, N8, system line |
| reject | producer | pending | reason, N8, release, system line |
| cancel | requester (pending/confirmed), producer (confirmed) | | reason, `closed_by`, N8, release, system line |
| deliver | either | confirmed | deduct from offer, N8, system line |
| confirm-and-deliver | producer, Mini App only | pending | one transaction: the `confirm` then the `deliver` side effects, both system lines, a **single** N8 (`delivered`). `POST /reservations/:id/confirm-and-deliver`; not offered as a bot quick action. |
| remind | job | pending, `reminded_at IS NULL`, now ≥ `expires_at − reminder` | N7, set `reminded_at` |
| expire | job | pending, now ≥ `expires_at` | N8 to both, release, system line |
| price-resolve | catalog sync | `unit_price_cents IS NULL`, product resolved, status pending or confirmed | set snapshot, N5 to the requester |
| cancel by catalogue | admin rejects the pending product | pending or confirmed | `closed_by` the admin, no reason, system line with `cause: product_rejected`, N8 to both parties, release; reservations are locked before the product's offers are withdrawn |

Row locks are taken in one order everywhere: the reservation first, then its offer
(`deliver` deducts, the catalogue cascade cancels then withdraws), and `create` locks only the
offer, so the paths cannot deadlock. Anyone who is not a party gets `FORBIDDEN` from every
reservation call; a party asking for an action the status no longer allows gets
`INVALID_TRANSITION` with the current status, which is what a stale quick action answers with.

### Offer

```
  publish ──► active ──(withdraw)──► withdrawn
                 │
                 ├──(available_until passed, job)──► expired
                 │
                 └──(nudge job)── stale=true/false flag, status unchanged
```
Editing quantity/date/note keeps `active`. After any producer edit the status is what the
calendar says: `active`, or `expired` when the resulting date has already passed (the same
rule the nightly job applies). An edit that puts the offer back on the board (`available`
from 0 to > 0, a new date on an `expired` offer, any edit of a `withdrawn` one) re-triggers
N3 ("re-published"); re-activation still respects one active offer per producer and product.
Any edit or *still available* also clears `stale` and `nudged_at` and stamps
`last_activity_at`. Withdraw applies to `active` and `expired` offers (the latter to tidy
*My offers*); a withdrawn offer cannot be withdrawn again.

### Member
`pending → approved → suspended ⇄ approved`, `pending → rejected`, `rejected → approved`
(admin changes their mind). Role `member ⇄ admin` orthogonal to status.

### Product
`pending → active` (sync match), or `pending → archived` when renamed to an existing active
sheet product (references transfer to that product; ADR-0015). Admin reject withdraws the
product's offers and cancels its reservations, then `pending → (deleted)` when nothing
references it, or `pending → archived` under a tombstone slug when offers or reservations do,
so the records stay and the name is free again (ADR-0018). `active ⇄ archived` by sync.

## 7. Realtime (WebSocket through the hub)

- The Mini App calls `POST /api/events/ticket` (auth as §4; any status, so the gate can
  listen too) and receives a random, single-use ticket valid for 30 s, stored in the hub's
  SQLite. It then opens `GET /api/events?ticket=<ticket>` as a WebSocket. A browser cannot set
  headers on a WebSocket and `initData` must not travel in a URL; the ticket carries the
  member id instead. A non-member's socket only ever receives `me.changed`.
- The Worker checks the `Origin` header against `PUBLIC_URL` and forwards the upgrade to the
  hub, which redeems the ticket and accepts the socket with the **Hibernation API**, tagged by
  member id. An idle socket costs no duration; the hub is asleep between events.
- Events are JSON frames named as before: `board.changed {}`, `reservation.changed {id}`,
  `message.new {reservationId}`, `me.changed {}`. Keep-alives use the platform's
  auto-response so a ping does not wake the object.
- Domain services call `hub.publish(memberIds, event)` on the hub port (`domain/ports.ts`)
  after the transaction commits; the Worker's implementation is one RPC per commit, in
  `waitUntil`, and the hub writes the frame to every socket tagged with those members. The
  outbox is written inside the same transaction as before; `hub.wake()` after the commit is
  what sends it (§8).
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
   if `hub.isViewing(memberId, reservationId)` says the recipient has the thread open (§7), or
   if the recipient is not an approved member (a suspended one cannot open the thread, PRD §2).
   Reading the thread (`POST …/read`) clears the key (the row keeps its history, `dedupe_key`
   becomes `NULL`) so the next burst notifies again; posting a message counts as reading, so a
   reply re-arms the throttle for the one who replied. The row quotes the message that opened
   the burst, cut to `MESSAGE_PREVIEW_LENGTH` characters.
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
| `offers.nudge` | next 09:00 Europe/Madrid | Per PRD US-3.4, over the dateless offers of approved producers that still have something to reserve: N10 after `offer_nudge_days` without activity, `stale` after `offer_stale_days_after_nudge` unanswered, N10 again weekly while stale. |
| `catalog.sync` | next minute 7 of an hour; also on demand | §10. Admin *Sync now* and `/sync` call `hub.runJob('catalog.sync')` and await its report. |

Rules:
- Deadline jobs read their next `due_at` from Postgres only during a run, while the database is
  already awake, and the Worker calls `hub.wake()` after any transaction that creates or moves
  a deadline (a new reservation, a confirmed one, an enqueued notification), so the alarm is
  never later than the work. `wake()` makes every deadline job due now (the dispatcher, the
  reminder, the expiry): each runs within a second, does what is due, and stores when it is
  next due, so one wake covers a notification and a deadline written in the same commit.
- **Nothing polls Postgres on a timer.** A five-minute sweep would keep Neon awake all month
  (ADR-0016). A Cron Trigger every 15 minutes calls `hub.ensureArmed()`, which reads only the
  hub's own storage and re-arms the alarm if it is missing; it is a liveness check, not a
  scheduler.
- Periodic jobs compute the next local occurrence with `Intl.DateTimeFormat` in Europe/Madrid,
  so DST is handled and 00:05 means 00:05 on the farm.
- A job that throws is logged with its name and retried by the hub with the outbox's backoff
  (1 m, 5 m, 30 m, then every 30 m); the other jobs' `due_at` rows are untouched. The alarm
  handler itself never throws, so a database that is down cannot turn the platform's retries
  into a tight loop.
- The first time the hub exists (its schedule is empty) every job is due at once, which is how
  the catalogue is imported right after a deploy: there is no boot to hook it to.
- `hub.runJob(name, params)` runs one job on demand inside the hub and returns its result; a
  domain error (a demoted actor) travels back as data and is rethrown by the Worker as the same
  `AppError`, so `/sync` and *Sync now* answer as they would have without the hub.

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
- The lifecycle hooks (`domain/catalog/lifecycle.ts`) run inside the catalogue transaction:
  merge moves the proposal's offers to the sheet product and refuses a producer who would end
  up with two active offers on it (ADR-0015); reject withdraws the proposal's offers and
  archives or deletes it (ADR-0018). The reservation side (`domain/reservations/cascade.ts`)
  fills the empty price snapshots of open reservations on resolution and, on rejection,
  cancels the open reservations before the offers are withdrawn, with N8 to both parties of
  each (`cause: product_rejected`); N5 goes to the proposer and the producers.
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
| `POST /reservations` | member | `{offerId, quantity}`; 409 `INSUFFICIENT_AVAILABILITY {available}`; 403 for my own offer; 422 `INVALID_TRANSITION` for a withdrawn, expired or suspended producer's offer. |
| `GET /reservations?side=incoming\|outgoing&state=active\|closed` | member | `state` defaults to `active`; `closed` covers the last 30 days by `closed_at`. Rows carry the viewer's `unread` count (§5). |
| `GET /reservations/:id` | party | Reservation + offer + product + counterpart summary, `unread`, and `thread {writable, writableUntil}` per PRD US-5.1. |
| `POST /reservations/:id/confirm` · `/reject` · `/cancel` · `/deliver` · `/confirm-and-deliver` | party (per §6) | `{reason?}` for reject/cancel (an empty body is fine); the last one is the Mini App's one-tap handover (ADR-0014). All answer the reservation with its offer and the caller's allowed actions. |
| `GET /reservations/:id/messages?after=<id>&limit=` | party | The thread oldest first, `{messages, hasMore}`, in pages of up to 100 starting after a message the caller holds; system lines carry their `meta`, text lines their sender and `mine`. |
| `POST /reservations/:id/messages` | party | `{body}`. 403 `THREAD_READONLY` when closed too long. |
| `POST /reservations/:id/read` | party | Mark read up to latest; answers `{unread}` (total, incoming, outgoing) as the badges now stand. |
| `POST /events/ticket` | any auth | Single-use 30 s ticket for the realtime socket (§7). |
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

`INTERNAL` also carries `error.requestId` as a structured field, equal to `X-Request-Id`;
request ids are generated by the server. Oversized bodies use 413 with `VALIDATION`.
With `SENTRY_DSN`, Worker and hub errors go to Sentry; expected domain errors do not.
The error hook retains only release, environment, correlation ids and stack locations;
requests, identities, breadcrumbs, SQL values and exception text are removed. Tracing,
logs and metrics are disabled; the hook is inactive without a DSN.

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
- Telegram theme via `themeParams` → CSS variables; forms carry their primary action as an
  in-page button (publish, reserve, send), which also works in the plain browser the e2e suite
  drives, so Telegram's `MainButton` is not used; `BackButton` wired to router; haptic feedback
  on actions; *Open in Telegram* goes through the SDK's `openTelegramLink` inside Telegram and
  is a plain `https://t.me/<username>` link elsewhere.
- Data layer: small fetch wrapper adding the `tma` header; per-screen stores with `refetch()`;
  the realtime store (one WebSocket, §7) dispatches refetches. Optimistic UI only for sending
  chat messages.
- i18n: `t(key, params)` from `packages/shared`, current language from `/me`; falls back to the
  Telegram `language_code` before `/me` resolves. Numbers/dates via `Intl` with
  `Europe/Madrid`.

## 13. Configuration

Nothing that belongs to one deployment is in the repository, so any group can clone it and
run its own AgroBot from its own variables. `apps/server/wrangler.jsonc` holds only what every
deployment shares (entry, compatibility, assets, the hub, the cron, a local Hyperdrive) and is
what `wrangler dev` runs. `pnpm deploy:worker` (`scripts/deploy-worker.mjs`) copies it to the
git-ignored `wrangler.deploy.jsonc` with the Worker name, the Hyperdrive id, the placement and
the `vars` taken from environment variables, runs `wrangler deploy` with it, and uploads the
secrets with `wrangler secret bulk` from stdin; only the variables listed below reach the
Worker, so a development-only one cannot leak by sitting in the same file. CI supplies them
from the GitHub Environment named after the branch; a hand deploy passes `--env-file`.
Development uses one `.env` at the repository root, which `wrangler dev` (`--env-file`), Vite
(`VITE_*` keys) and the CLI scripts all read. `env.ts` validates the variables among the
bindings with zod at the start of every invocation and fails the request with a readable list
of problems, by name; nothing is ever logged by value.

"Where" says what the value becomes on the Worker; every `var` and `secret` is given to
`pnpm deploy:worker` as an environment variable of the same name.

| Variable | Where | Required | Notes |
|---|---|---|---|
| `WORKER_NAME` | deploy only | no | The Worker's name, `agrobot` by default; `agrobot-staging` for the staging deployment. |
| `HYPERDRIVE_ID` | deploy only | yes | The id from `wrangler hyperdrive create`, one per deployment, pointing at that Neon branch's pooled connection string. |
| `PLACEMENT_REGION` | deploy only | no | `aws:eu-central-1` by default: the Worker runs next to the database. |
| `BOT_TOKEN` | secret | yes | AgroBot 1.0's existing token (ADR-0013). 1.0 must be stopped before 2.0 uses it — one token, one consumer. |
| `TELEGRAM_WEBHOOK_SECRET` | secret | yes | Random 32+ chars; checked on every webhook update. |
| `BOT_USERNAME`, `MINIAPP_SHORT_NAME` | var | yes | For deep links. `BOT_USERNAME` is 1.0's; the Mini App short name is created in @BotFather on the same bot. |
| `PUBLIC_URL` | var | yes | HTTPS base of the Worker (`https://<name>.<account>.workers.dev` or the custom domain). The webhook is `PUBLIC_URL/telegram/webhook`; also the accepted `Origin` for sockets. |
| `HYPERDRIVE` | binding | yes | Hyperdrive configuration pointing at Neon's pooled connection string; `env.HYPERDRIVE.connectionString` is what the driver opens. |
| `DATABASE_URL` | `.env` / CI secret | CLI only | Direct Postgres URL for `db:migrate`, `db:seed`, `db:generate` and the integration tests (`TEST_DATABASE_URL`). In development it is also the local Hyperdrive target (`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`). Never a Worker var. |
| `ADMIN_TELEGRAM_IDS` | var | yes (first deploy) | Comma-separated; auto-approved as admins on `/start`. |
| `CATALOG_SOURCE` | var | yes | `sheets` or `csv`. |
| `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_RANGE` | var | sheets mode | Range defaults to `Productes!A:E` (PRD §6). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | secret | sheets mode | Base64 of the key file; the sheet is shared read-only with that service account. |
| `CATALOG_CSV_URL` | var | csv mode | |
| `NODE_ENV` | var | no | `production` on the Worker, `development` in `.env`, `test` in tests. Gates the dev auth bypass. |
| `DEFAULT_LOCALE` | var | no | `ca`. |
| `TZ` | var | no | `Europe/Madrid` (display only; storage is UTC). |
| `LOG_LEVEL` | var | no | `info`. |
| `GIT_COMMIT` | var | no | The deployed commit, for `/status` and `/health`; CI passes the sha, a hand deploy takes `git rev-parse`. |
| `SENTRY_DSN` | secret | no | Enables error tracking. |
| `DEV_AUTH_BYPASS_TELEGRAM_ID` | `.env` only | dev only | Refused when `NODE_ENV=production`. |
| `TELEGRAM_API_ROOT` | `.env` only | dev/test only | Base URL of the Bot API, for a local fake (the e2e suite records the notifications the hub sent, §16). Refused when `NODE_ENV=production`. |

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
  points at Docker Postgres (`DATABASE_URL`). `scripts/wrangler-dev.mjs` starts it with the
  repository `.env` as its variables, so there is one configuration file.
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
  (`wrangler deploy --dry-run --outdir dist`), in that order. Wrangler bundles `src/worker.ts`
  with esbuild; the migrations folder is not shipped, it is applied from CI.
- **CI** (`.github/workflows/ci.yml`) on every PR and on `main` and `staging`: `pnpm lint`,
  `pnpm typecheck`, `pnpm test` (unit + integration with a Postgres service container + hub
  tests inside workerd), `pnpm build`, `pnpm e2e` (Playwright against `wrangler dev` with the
  local Hyperdrive on `agrobot_test`, the dev auth bypass, a seeded DB and a fresh hub state).
  GitHub Actions is free for this public repository.
- **Deploy** (`deploy` job in the same workflow, after the checks pass, using the GitHub
  Environment named after the branch: `main` → `production`, `staging` → `staging`):
  1. `pnpm db:migrate` against Neon (`DATABASE_URL` environment secret, the direct string;
     forward-only).
  2. `pnpm deploy:worker` (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and the variables of
     §13): generates `wrangler.deploy.jsonc`, `wrangler deploy`, then `wrangler secret bulk`
     for `BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `SENTRY_DSN`. A
     deploy never removes a secret; the few seconds between the two uploads are the only time
     a first deployment answers 500 for lack of them.
  3. `pnpm bot:set-webhook` (`BOT_TOKEN`, `PUBLIC_URL`, `TELEGRAM_WEBHOOK_SECRET`), idempotent;
     it also publishes the command menu in both languages.

  The staging Worker (`WORKER_NAME=agrobot-staging`, its own Neon branch and Hyperdrive
  configuration, a throwaway bot) is the same workflow from the `staging` branch with the
  `staging` GitHub Environment. The README's "First-time setup" lists the one-off account
  steps; `pnpm deploy:worker --dry-run` validates a configuration without uploading.
- **Rollback.** `wrangler rollback --name <WORKER_NAME>` restores the previous Worker version
  in seconds. Migrations are never rolled back; write a compensating migration.
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
| Hub | Vitest under `@cloudflare/vitest-plugin` (inside workerd) | Alarm seeding and re-arming, `wake()`, full-batch re-run, retry backoff, `runJob` results and domain errors, ticket issue/redeem/expiry, socket tagging, publish fan-out and presence, rate counters. Next-due math (Madrid local time, DST) is a plain unit test. Jobs are a fake runner here; they have their own integration tests. |
| Mini App | Vitest + Testing Library | Components with i18n and both languages; reserve form validation per unit. |
| E2E | Playwright against `wrangler dev` | Two browser contexts (producer, requester): publish → appears on board → reserve → confirm → chat both ways → deliver. Admin approve flow. A fake Bot API (`start-server.mjs`, `TELEGRAM_API_ROOT`) records what the hub dispatched, so a notification is asserted end to end. Runs in CI. |
| i18n | build step | Script fails if `ca.json` and `es.json` keys differ or a key used in code is missing. |

## 17. Security checklist

- initData validation with constant-time compare; reject when `hash` missing or `auth_date`
  stale; never trust `user` fields from the client body.
- Webhook secret header check; reject other methods/paths from Telegram IP ranges not needed.
- All authorization inside domain services (not only in routes) so quick actions and API share it.
- Rate limit mutating `/api/*` calls per member (e.g. 60/min) and messages per thread (20/min)
  with counters in the hub's SQLite (one instance, exact counts).
- The limits are 60 mutations per member per fixed 60-second window (tickets included), and
  20 messages per member per reservation per window, so one party cannot spend the other's
  allowance. A 429 includes `Retry-After` seconds. Reads do not consume either allowance;
  counters fail closed if the hub is unavailable. HTTP bodies are limited to 16 KiB for the
  API and 64 KiB for Telegram updates, including streamed bodies, before parsing or auth.
- Settings use the shared per-key schema from PRD US-7.1. Admin writes re-check the actor in
  the transaction, upsert only supplied keys with audit fields, then call `hub.wake()` so a
  changed reminder cannot leave the cached next deadline too late. No settings cache.
- Socket tickets are random (128 bits), single-use, 30 s; the upgrade checks `Origin` against
  `PUBLIC_URL`; `initData` never appears in a URL or a log.
- Body size limits; message length limits; HTML-escape everything we send to Telegram
  (`parse_mode: 'HTML'`, one escape helper, unit-tested).
- Secrets only as Worker secrets (uploaded by `pnpm deploy:worker` through `wrangler secret
  bulk` on stdin, from the CI environment or a git-ignored `--env-file`) or the local `.env`;
  never in `wrangler.jsonc` or the repository; `env.ts` never logs values.
- Dependencies pinned via lockfile; `pnpm audit` in CI as non-blocking report.
