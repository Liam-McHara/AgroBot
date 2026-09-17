# CLAUDE.md — working in the AgroBot repository

AgroBot is a private tool for a group of farmers to share surplus produce: a Telegram bot plus
a Telegram Mini App backed by one Node service and Postgres. Version 2.0 is being built here
from a written specification; version 1.0 is frozen under `legacy/`.

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
- **Strict TypeScript, tests with the change.** Domain rules get unit tests; routes and jobs get
  integration tests against real Postgres; user flows get Playwright coverage per the roadmap.

## Repository layout (target; created in M0)

```
apps/server     Hono + grammY + Drizzle + jobs        packages/shared  zod contracts, enums, i18n
apps/miniapp    Svelte 5 + Vite Telegram Mini App     docs/            the specification
legacy/         AgroBot 1.0, frozen                   .github/         CI
```
Dependency rule: `miniapp` and `server` → `shared`. `domain/` inside the server imports no
HTTP, bot or integration code.

## Commands

Until M0 lands there is nothing to run at the root. M0 must replace this block with the real
commands; the intended set is:

```bash
pnpm install
docker compose up -d                 # local Postgres
cp .env.example .env                 # then fill BOT_TOKEN etc.
pnpm db:migrate && pnpm db:seed
pnpm dev                             # server (polling bot) + Mini App
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm e2e                             # Playwright
```

## Git

- Branch per milestone or task (`m0-foundation`, `m3-board-search`).
- **Commits follow [Conventional Commits](https://www.conventionalcommits.org) 1.0.0:**
  `<type>(<scope>): <subject>`, imperative and lower-case, no trailing period, ≤72 characters.
- Types: `feat` · `fix` · `docs` · `refactor` · `test` · `build` · `ci` · `chore` · `perf` ·
  `style` · `revert`. Anything user-visible is `feat` or `fix`; spec edits are `docs`.
- Scopes are the workspace or area touched: `server`, `miniapp`, `shared`, `db`, `bot`, `api`,
  `domain`, `jobs`, `i18n`, `docs`, `ci`. Omit the scope only for repo-wide changes.
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
