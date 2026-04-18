# Multi-stage Dockerfile for @restora/license-server.
#
# Build context is the MONOREPO ROOT (we need pnpm-lock.yaml + workspace
# packages + shared prisma schemas). Always build from the repo root:
#   docker build -f apps/license-server/Dockerfile -t restora/license-server .
#
# Deploy target: a single cheap DO droplet (see infra/license-droplet/
# docker-compose.yml). Postgres + Caddy run in sibling containers there.

# ─── Stage 1: builder — install deps, generate Prisma client, nest build ──
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /repo

# Copy manifests first so the pnpm-install layer caches on lockfile hits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc .pnpmfile.cjs turbo.json ./
COPY tsconfig.base.json ./

# Workspace packages referenced by license-server via `workspace:*`. Keep
# this list in sync with apps/license-server/package.json's devDeps +
# deps that use the workspace: protocol.
COPY packages/config/package.json packages/config/
COPY apps/license-server/package.json apps/license-server/
COPY apps/license-server/prisma apps/license-server/prisma

RUN pnpm install --frozen-lockfile --filter @restora/license-server...

# Copy source after deps install so code churn doesn't bust the install
# layer. tsconfig bases + workspace package source files land here too.
COPY packages/config packages/config
COPY apps/license-server apps/license-server

# Prisma client has to be generated BEFORE nest build because the server
# imports from the generated output path (apps/license-server/prisma/client).
RUN pnpm --filter @restora/license-server exec prisma generate --schema apps/license-server/prisma/schema.prisma \
 && pnpm --filter @restora/license-server run build

# ─── Stage 2: pruned deps — prod-only node_modules ────────────────────────
FROM node:22-bookworm-slim AS prod-deps

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc .pnpmfile.cjs ./
COPY packages/config/package.json packages/config/
COPY apps/license-server/package.json apps/license-server/
COPY apps/license-server/prisma apps/license-server/prisma

# `--prod` drops devDependencies; the filter + recursive install trims
# the workspace down to what license-server actually imports.
RUN pnpm install --frozen-lockfile --prod --filter @restora/license-server...

# Regenerate Prisma client in the prod tree so it lives at the final path
# the runtime image will expect (engines + query engine copied in).
RUN pnpm --filter @restora/license-server exec prisma generate --schema apps/license-server/prisma/schema.prisma

# ─── Stage 3: runtime — minimal image with just dist + prod node_modules ──
FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd  --system --uid 1001 --gid app --shell /bin/false app

WORKDIR /app

# Copy only what the runtime needs. No pnpm, no git, no source tree.
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/license-server/node_modules ./apps/license-server/node_modules
COPY --from=prod-deps /repo/packages/config/node_modules ./packages/config/node_modules
COPY --from=builder  /repo/apps/license-server/dist    ./apps/license-server/dist
COPY --from=builder  /repo/apps/license-server/prisma  ./apps/license-server/prisma
COPY --from=builder  /repo/apps/license-server/package.json ./apps/license-server/package.json
COPY --from=builder  /repo/packages/config ./packages/config

USER app

ENV NODE_ENV=production
ENV PORT=3002
EXPOSE 3002

# tini reaps zombies and forwards signals so `docker stop` is graceful.
ENTRYPOINT ["/usr/bin/tini", "--"]

# migrate deploy is idempotent — safe to run on every container start.
CMD ["sh", "-c", "node apps/license-server/node_modules/prisma/build/index.js migrate deploy --schema apps/license-server/prisma/schema.prisma && node apps/license-server/dist/main.js"]
