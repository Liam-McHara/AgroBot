# syntax=docker/dockerfile:1

# AgroBot 2.0 image: one container with the API, the bot and the built Mini App.
# Build context is the repository root:  docker build -f apps/server/Dockerfile .
#
# Deprecated. ADR-0016 moves the runtime to Cloudflare Workers; roadmap M2.5 deletes this file
# together with the Node entry point it packages. Until then it still describes how the
# current `node dist/index.js` runs, which is why it is kept and not updated.

# ── Stage 1: install every workspace dependency ───────────────────────────────────────────
FROM node:22-alpine AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/miniapp/package.json apps/miniapp/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── Stage 2: build shared, the Mini App and the server ────────────────────────────────────
FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/miniapp apps/miniapp

RUN pnpm --filter @agrobot/shared build \
  && pnpm --filter @agrobot/miniapp build \
  && pnpm --filter @agrobot/server build

# The server serves the Mini App from ./public relative to its working directory.
RUN cp -r apps/miniapp/dist apps/server/public

# Drop everything that is not needed to run: `deploy` copies the package's `files`
# (dist, public) plus its production dependencies, with @agrobot/shared materialized.
RUN pnpm --filter @agrobot/server --prod deploy --legacy /runtime

# ── Stage 3: runtime ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# The version comes from the deployed package.json; only the commit has to be baked in.
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
ENV NODE_ENV=production
ENV PORT=8080
ENV TZ=Europe/Madrid
WORKDIR /app

COPY --from=build --chown=node:node /runtime ./

USER node
EXPOSE 8080

# Migrations run on boot, before the HTTP server listens (ARCH §15, src/index.ts).
CMD ["node", "dist/index.js"]
