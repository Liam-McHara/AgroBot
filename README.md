# AgroBot

A private tool for a group of farmers to share their surplus with each other. Members see, at
any time, what the others are offering and how much is left, reserve part or all of it, and
coordinate delivery in a private chat. Prices come from the price list the group already keeps
in a Google Sheet. It lives inside Telegram: a bot for identity and notifications, a Telegram
Mini App for the screens.

## Status

**2.0 is under construction.** The specification lives in [`docs/`](docs/README.md) and is the
source of truth. Milestones **M0 Foundation**, **M1 Identity and membership**, **M2 Catalogue**
and **M2.5 Free hosting** are done in code: the workspace runs on Cloudflare's runtime
(`wrangler dev` locally), strangers apply with `/start`, admins approve from Telegram or the
Mini App, products and prices sync from the sheet, members can propose missing products, admins
can review sync health, and the Mini App gets live updates over a WebSocket held by one Durable
Object ([ADR-0016](docs/adr/0016-hosting-on-cloudflare-workers-and-neon.md),
[ADR-0017](docs/adr/0017-durable-object-for-jobs-and-realtime.md)). Every screen speaks Catalan
and Spanish. What M2.5 still needs is a **first deploy to the staging Worker**, which takes a
Cloudflare and a Neon account ([first-time setup](#first-time-setup) below); then M3 in
[docs/roadmap.md](docs/roadmap.md). The 1.0 prototype is frozen under [`legacy/`](legacy/README.md).

| Document | Purpose |
|---|---|
| [docs/README.md](docs/README.md) | How the documents fit together and how to start a milestone in a fresh session |
| [docs/prd.md](docs/prd.md) | Product requirements: roles, principles, user stories, notifications, admin, NFRs |
| [docs/architecture.md](docs/architecture.md) | Technical design: monorepo, auth, data model, state machines, API, jobs, deploy |
| [docs/adr/](docs/adr/README.md) | Decision records with alternatives considered |
| [docs/roadmap.md](docs/roadmap.md) | Milestones M0–M6 (plus M2.5, the hosting move) with tasks and definitions of done |
| [docs/legacy-review.md](docs/legacy-review.md) | What 1.0 did and the lessons carried forward |

## Stack (2.0)

TypeScript everywhere · pnpm workspace · **grammY** (bot) · **Hono** (API) · **Drizzle** on
**Postgres** · **Svelte 5 + Vite** Mini App · Vitest + Playwright · **Cloudflare Workers** with
one **Durable Object** for jobs and realtime, **Neon Postgres** through Hyperdrive, all on free
plans ([ADR-0016](docs/adr/0016-hosting-on-cloudflare-workers-and-neon.md),
[ADR-0017](docs/adr/0017-durable-object-for-jobs-and-realtime.md)).

## Getting started

You need **Node 22.22.2+ (22.x)**, **pnpm 10** (`corepack enable`) and **Docker** for local Postgres.

```bash
nvm use
pnpm install
docker compose up -d                 # Postgres 16 on :5432, plus the agrobot_test database
cp .env.example .env                 # then fill in BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, ADMIN_TELEGRAM_IDS
pnpm db:migrate && pnpm db:seed
pnpm dev
```

`pnpm dev` starts three things, all reading the one `.env`:

- the Worker on <http://localhost:8080> through `wrangler dev`: the real runtime, the API, the
  webhook, the `AgroBotHub` Durable Object with its alarm and sockets, and a local Hyperdrive
  that points at the Docker Postgres;
- the Mini App on <http://localhost:5173> (Vite), which proxies `/api` — the WebSocket included
  — to the Worker;
- the Telegram forwarder (`scripts/dev-telegram.mjs`): the Worker only speaks webhooks, so this
  script deletes the throwaway bot's webhook, long-polls Telegram and POSTs every update to
  `http://localhost:8080/telegram/webhook` with the secret header. It stays quiet if
  `BOT_TOKEN` is still the placeholder.

For the bot, create a **throwaway** bot with [@BotFather](https://t.me/BotFather) and put its
token in `BOT_TOKEN`. Never the group's production token: 2.0 reuses AgroBot 1.0's identity,
and one token can have exactly one consumer
([ADR-0013](docs/adr/0013-reuse-the-1-0-bot-identity.md)). Put your own Telegram id (ask
[@userinfobot](https://t.me/userinfobot)) in `ADMIN_TELEGRAM_IDS` to be an admin, and any 32+
random characters in `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`).

Opened at <http://localhost:5173> rather than inside Telegram, the Mini App signs in as
`VITE_DEV_TELEGRAM_ID` through the development bypass, which `env.ts` refuses to enable in
production. Switch member from the browser console:

```js
localStorage.setItem('agrobot.devTelegramId', '900000002'); // the seeded es-speaking member
```

To open it inside Telegram, expose the Worker (`cloudflared tunnel --url http://localhost:8080`),
set `PUBLIC_URL` to the tunnel URL, stop the forwarder and run `pnpm bot:set-webhook`, then
point the Mini App URL in @BotFather at the tunnel. Back to the forwarder afterwards: it deletes
the webhook again when it starts.

### Catalogue sources

Create a `Productes` tab with `Producte`, `Unitat`, `Preu` and optional `Categoria` and
`Producto (es)` columns ([full rules](docs/prd.md#6-catalogue-products-and-prices)). Configure
one source in `.env`:

- **Google Sheets:** `CATALOG_SOURCE=sheets`, `GOOGLE_SHEET_ID`,
  `GOOGLE_SHEET_RANGE=Productes!A:E`, and `GOOGLE_SERVICE_ACCOUNT_JSON` containing the base64
  service-account JSON key. Enable the Sheets API and share the sheet with that account's
  email as a **viewer**. The adapter signs its own JWT with WebCrypto and requests only
  `spreadsheets.readonly` access.
- **Published CSV:** `CATALOG_SOURCE=csv` and `CATALOG_CSV_URL` pointing at the tab's
  publish-to-web CSV URL. This source is readable by anyone holding its URL.

Sync runs at minute 7 of every hour from the hub, and once when the hub first exists after a
deploy. Admins can run `/sync` in Telegram or **Admin → Catalogue → Sync now**; both run the job
inside the hub and wait for its report. `/status` reports membership, offers, reservations, last
sync and app version. The admin screen shows row errors and unit-change warnings; failed reads
or zero valid rows preserve the existing catalogue and queue N12. Members can search and
propose products under **My offers**; offer publication arrives in M3.

To check the full M2 scenario without a Google account:

```bash
pnpm --filter @agrobot/server exec vitest run test/catalog.test.ts
pnpm build
pnpm e2e
```

The integration and browser suites serve their own CSV fixtures over local HTTP, including
price edits, missing rows, invalid units, empty sheets and a proposal resolved on the next sync.
The Google adapter is tested against a key pair and a mocked API; a deployment still needs its
real sheet and key.

### Checks

```bash
pnpm lint          # eslint + prettier + the ca/es catalogue check
pnpm typecheck
pnpm test          # unit everywhere, integration against Postgres, the hub inside workerd
pnpm build         # shared, Mini App, then wrangler deploy --dry-run
pnpm e2e           # Playwright against wrangler dev; needs pnpm build first
```

Integration tests need Postgres at `TEST_DATABASE_URL` (default `…/agrobot_test`, created by
`docker compose`). Without it they skip locally with a warning, and fail in CI. The e2e suite
uses the same database, resets it, and boots `wrangler dev` on `:8081` with the dev auth bypass
and a fresh hub; the first run needs `pnpm exec playwright install chromium`.

## Deployment

Production is one Worker plus one Durable Object on the Workers Free plan and a Neon free
Postgres reached through Hyperdrive. There is no container and no always-on process: jobs run
from the Durable Object's alarm when something is due, the Mini App gets live updates over a
WebSocket held by the same object, and GitHub Actions applies migrations, runs
`pnpm deploy:worker` and registers the Telegram webhook on every push to `main` (production)
and `staging` (staging). Backups are Neon's six-hour point-in-time restore. The design, the
free-plan budget and the deploy steps are in
[docs/architecture.md §15](docs/architecture.md#15-build-ci-deployment).

**Everything that belongs to one deployment is an environment variable**, never a tracked
file: `pnpm deploy:worker` generates the Worker configuration from them and uploads the
secrets. Another group of farmers can clone this repository, set its own variables and have
its own AgroBot without touching `wrangler.jsonc`.

### First-time setup

Done once per environment (`staging` first, per the roadmap), with the Cloudflare and Neon
CLIs logged in. Nothing here changes a file in the repository.

1. **Neon.** Create a project in Frankfurt (`aws-eu-central-1`) with a `production` and a
   `staging` branch. For each branch note the **pooled** connection string (for Hyperdrive) and
   the **direct** one (for migrations).
2. **Hyperdrive.** `wrangler hyperdrive create agrobot-staging --connection-string '<pooled>'`
   (and the same for production); note the id each command prints.
3. **Variables.** Put the deployment's values in the GitHub Environment `staging` (later
   `production`), or, to deploy by hand, in a git-ignored file such as `.env.staging`:

   | Kind | Names |
   |---|---|
   | Variables | `WORKER_NAME` (default `agrobot`), `HYPERDRIVE_ID`, `PLACEMENT_REGION` (default `aws:eu-central-1`), `PUBLIC_URL` (`https://<WORKER_NAME>.<account>.workers.dev`), `BOT_USERNAME`, `MINIAPP_SHORT_NAME` (default `app`), `ADMIN_TELEGRAM_IDS`, `CATALOG_SOURCE` and its `GOOGLE_SHEET_ID` / `GOOGLE_SHEET_RANGE` or `CATALOG_CSV_URL`, `DEFAULT_LOCALE`, `LOG_LEVEL` |
   | Secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL` (the direct Neon string), `BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON` (sheets mode), `SENTRY_DSN` (optional) |

   Staging uses a throwaway bot; production uses 1.0's token (ADR-0013).
4. **Deploy.** Push to `staging` (or `main`): the workflow runs the checks, applies the
   migrations, runs `pnpm deploy:worker` and `pnpm bot:set-webhook`. By hand:
   `pnpm db:migrate`, `pnpm deploy:worker --env-file .env.staging`,
   `pnpm bot:set-webhook` with the same variables exported. The first request (or the
   15-minute heartbeat) arms the hub, which imports the catalogue at once.
5. **Seed the group settings** once: `DATABASE_URL='<direct>' NODE_ENV=production pnpm db:seed`
   so no dev members are created. Admins bootstrap themselves with `/start`
   (`ADMIN_TELEGRAM_IDS`).
6. Register the Mini App short name (`MINIAPP_SHORT_NAME`) on the bot in @BotFather, pointing
   at `PUBLIC_URL`.

`pnpm deploy:worker --dry-run` validates a configuration without uploading anything.
`wrangler rollback --name <WORKER_NAME>` undoes a bad deploy in seconds; migrations are
forward-only.

## License

GPL-3.0, see [LICENSE](LICENSE).
