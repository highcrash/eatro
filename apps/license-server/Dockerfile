# Multi-stage Dockerfile for @restora/license-server.
#
# Build context is the MONOREPO ROOT. Always build from the repo root:
#   docker build -f apps/license-server/Dockerfile -t restora/license-server .

# ─── Stage 1: builder — install deps, generate Prisma client, nest build ──
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc .pnpmfile.cjs turbo.json ./
COPY tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY apps/license-server/package.json apps/license-server/
COPY apps/license-server/prisma apps/license-server/prisma

# --ignore-scripts skips the root husky "prepare" hook which would
# otherwise fail in the container (no .git, no husky binary on first run).
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @restora/license-server...

COPY packages/config packages/config
COPY apps/license-server apps/license-server

# Use the package's own prisma:generate script — its --schema is relative
# to the package cwd (./prisma/schema.prisma), which is what `pnpm --filter`
# resolves to. Passing the absolute repo-rooted path here would fail.
RUN pnpm --filter @restora/license-server run prisma:generate \
 && pnpm --filter @restora/license-server run build

# ─── Stage 2: runtime — slim image; reuses builder's node_modules ─────────
# We used to have a separate prod-deps stage, but dropping dev-only deps
# also dropped the Prisma CLI (which we need at container start for
# `prisma migrate deploy`). Moving the CLI to dependencies vs. keeping
# the builder's node_modules — the latter is simpler and the extra size
# (~100 MB of typescript / jest / etc) is fine for a low-traffic license API.
FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 app \
    && useradd  --system --uid 1001 --gid app --shell /bin/false app

WORKDIR /app

COPY --from=builder /repo/node_modules                     ./node_modules
COPY --from=builder /repo/apps/license-server/node_modules ./apps/license-server/node_modules
COPY --from=builder /repo/packages/config/node_modules     ./packages/config/node_modules
COPY --from=builder /repo/apps/license-server/dist         ./apps/license-server/dist
COPY --from=builder /repo/apps/license-server/prisma       ./apps/license-server/prisma
COPY --from=builder /repo/apps/license-server/package.json ./apps/license-server/package.json
COPY --from=builder /repo/packages/config                  ./packages/config

USER app

ENV NODE_ENV=production
ENV PORT=3002
EXPOSE 3002

ENTRYPOINT ["/usr/bin/tini", "--"]

# migrate deploy is idempotent — safe to run on every container start.
CMD ["sh", "-c", "node apps/license-server/node_modules/prisma/build/index.js migrate deploy --schema apps/license-server/prisma/schema.prisma && node apps/license-server/dist/main.js"]
