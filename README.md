# AgroBot

A private tool for a group of farmers to share their surplus with each other. Members see, at
any time, what the others are offering and how much is left, reserve part or all of it, and
coordinate delivery in a private chat. Prices come from the price list the group already keeps
in a Google Sheet. It lives inside Telegram: a bot for identity and notifications, a Telegram
Mini App for the screens.

## Status

**2.0 is specified and awaiting implementation.** The specification is complete and lives in
[`docs/`](docs/README.md); the first milestone (M0 Foundation) creates the workspace described
there. The 1.0 prototype is frozen under [`legacy/`](legacy/README.md).

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
**Postgres** · **Svelte 5 + Vite** Mini App · Vitest + Playwright · one container, e.g. Fly.io
with Neon Postgres.

## Getting started

Not yet: the workspace is created in roadmap milestone M0. Until then, see
[docs/README.md](docs/README.md#starting-a-milestone-in-a-fresh-claude-code-session) for the
kick-off prompt.

## License

GPL-3.0, see [LICENSE](LICENSE).
