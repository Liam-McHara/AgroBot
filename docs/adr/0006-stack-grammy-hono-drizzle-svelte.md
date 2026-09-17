# ADR-0006: Stack: pnpm monorepo, grammY, Hono, Drizzle, Svelte 5, Vitest, Playwright

- Status: Accepted
- Date: 2026-09-17

## Context
TypeScript end to end is a given (1.0 was TypeScript; shared types between server and Mini
App are valuable). Within that, we want small, well-documented libraries that fit a single
Node process and a mobile web view, and a test setup that runs in CI without heroics.

## Decision
- **pnpm workspace** with `apps/server`, `apps/miniapp`, `packages/shared`.
- **grammY** for the bot (webhook in prod, polling in dev).
- **Hono** for HTTP, with zod validation from shared contracts.
- **Drizzle ORM + drizzle-kit** on Postgres; migrations committed.
- **Svelte 5 + Vite** for the Mini App with `@telegram-apps/sdk`.
- **Vitest** (unit, integration against real Postgres), **Playwright** (e2e),
  **Testing Library** for components. ESLint + Prettier. Node 22.

## Consequences
- One language, one package manager, shared zod schemas as the API contract.
- Svelte gives a small bundle and simple reactivity for a UI that is mostly lists and forms;
  fewer contributors know it than React, accepted trade-off for a small project.
- Drizzle keeps SQL visible (important for the availability query and row locks).
- grammY and Hono are lighter than Telegraf and Express and have first-class TypeScript types.

## Alternatives considered
- **Telegraf + Express + Prisma** (closer to 1.0): heavier, Prisma hides SQL we want to see.
- **React** for the Mini App: larger ecosystem, larger bundle; owner prefers Svelte.
- **SvelteKit** full framework: unnecessary server features here; may still be used in SPA
  mode if routing needs grow (decision at M1).
