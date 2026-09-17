# AgroBot

A private tool for a group of farmers to share their surplus with each other. Members see, at
any time, what the others are offering and how much is left, reserve part or all of it, and
coordinate delivery in a private chat. Prices come from the price list the group already keeps
in a Google Sheet. It lives inside Telegram: a bot for identity and notifications, a Telegram
Mini App for the screens.

## Status

**2.0 is under construction.** The specification lives in [`docs/`](docs/README.md) and is the
source of truth. Milestones **M0 Foundation**, **M1 Identity and membership** and **M2 Catalogue**
are done: the workspace runs, strangers apply with `/start`, admins approve from Telegram or the Mini App,
products and prices sync from the sheet, members can propose missing products, and admins
can review sync health. Every screen speaks Catalan and Spanish. The next milestone is M3 in
[docs/roadmap.md](docs/roadmap.md). The 1.0 prototype is frozen under
[`legacy/`](legacy/README.md).

| Document | Purpose |
|---|---|
| [docs/README.md](docs/README.md) | How the documents fit together and how to start a milestone in a fresh session |
| [docs/prd.md](docs/prd.md) | Product requirements: roles, principles, user stories, notifications, admin, NFRs |
| [docs/architecture.md](docs/architecture.md) | Technical design: monorepo, auth, data model, state machines, API, jobs, deploy |
| [docs/adr/](docs/adr/README.md) | Decision records with alternatives considered |
| [docs/roadmap.md](docs/roadmap.md) | Milestones M0–M6 with tasks and definitions of done |
| [docs/legacy-review.md](docs/legacy-review.md) | What 1.0 did and the lessons carried forward |

## Stack (2.0)

TypeScript everywhere · pnpm workspace · **grammY** (bot) · **Hono** (API) · **Drizzle** on
**Postgres** · **Svelte 5 + Vite** Mini App · Vitest + Playwright · one container on
**Railway** with Railway Postgres ([ADR-0012](docs/adr/0012-hosting-on-railway.md)).

## Getting started

You need **Node 22.22.2+ (22.x)**, **pnpm 10** (`corepack enable`) and **Docker** for local Postgres.

```bash
nvm use
pnpm install
docker compose up -d                 # Postgres 16 on :5432, plus the agrobot_test database
cp .env.example .env                 # then fill in BOT_TOKEN and ADMIN_TELEGRAM_IDS
pnpm db:migrate && pnpm db:seed
pnpm dev
```

`pnpm dev` starts the server on <http://localhost:8080> (bot in long-polling mode) and the
Mini App on <http://localhost:5173>, which proxies `/api` to the server.

For the bot, create a **throwaway** bot with [@BotFather](https://t.me/BotFather) and put its
token in `BOT_TOKEN`. Never the group's production token: 2.0 reuses AgroBot 1.0's identity,
and one token can have exactly one consumer
([ADR-0013](docs/adr/0013-reuse-the-1-0-bot-identity.md)). Put your own Telegram id (ask
[@userinfobot](https://t.me/userinfobot)) in `ADMIN_TELEGRAM_IDS` to be an admin.

Opened at <http://localhost:5173> rather than inside Telegram, the Mini App signs in as
`VITE_DEV_TELEGRAM_ID` through the development bypass, which `env.ts` refuses to enable in
production. Switch member from the browser console:

```js
localStorage.setItem('agrobot.devTelegramId', '900000002'); // the seeded es-speaking member
```

To open it inside Telegram, expose the server (`cloudflared tunnel --url http://localhost:8080`),
set `PUBLIC_URL` and `TELEGRAM_WEBHOOK_SECRET`, switch `BOT_MODE=webhook`, and point the Mini
App URL in @BotFather at the tunnel.

### Catalogue sources

Create a `Productes` tab with `Producte`, `Unitat`, `Preu` and optional `Categoria` and
`Producto (es)` columns ([full rules](docs/prd.md#6-catalogue-products-and-prices)). Configure
one source in `.env`:

- **Google Sheets:** `CATALOG_SOURCE=sheets`, `GOOGLE_SHEET_ID`,
  `GOOGLE_SHEET_RANGE=Productes!A:E`, and `GOOGLE_SERVICE_ACCOUNT_JSON` containing the base64
  service-account JSON key. Enable the Sheets API and share the sheet with that account's
  email as a **viewer**. The adapter requests only `spreadsheets.readonly` access.
- **Published CSV:** `CATALOG_SOURCE=csv` and `CATALOG_CSV_URL` pointing at the tab's
  publish-to-web CSV URL. This source is readable by anyone holding its URL.

Sync runs hourly and on boot if no sync has ever been attempted. Admins can run `/sync` in
Telegram or **Admin → Catalogue → Sync now**. `/status` reports membership, offers,
reservations, last sync and app version. The admin screen shows row errors and unit-change
warnings; failed reads or zero valid rows preserve the existing catalogue and queue N12.
Members can search and propose products under **My offers**; offer publication arrives in M3.

To check the full M2 scenario without a Google account:

```bash
pnpm --filter @agrobot/server exec vitest run test/catalog.test.ts
pnpm build
pnpm e2e
```

The integration and browser suites serve their own CSV fixtures over local HTTP, including
price edits, missing rows, invalid units, empty sheets and a proposal resolved on the next sync.
The Google adapter has mocked API tests; a deployment still needs its real sheet and key.

### Checks

```bash
pnpm lint          # eslint + prettier + the ca/es catalogue check
pnpm typecheck
pnpm test          # unit everywhere, integration against Postgres
pnpm build
pnpm e2e           # Playwright against the built server; needs pnpm build first
```

Integration tests need Postgres at `TEST_DATABASE_URL` (default `…/agrobot_test`, created by
`docker compose`). Without it they skip locally with a warning, and fail in CI. The e2e suite
uses the same database, resets it, and boots the built server on `:8081` with the dev auth
bypass; the first run needs `pnpm exec playwright install chromium`.

## License

GPL-3.0, see [LICENSE](LICENSE).
