# Multi-stage Dockerfile for @restora/license-admin (Vite SPA).
#
# Build context is the MONOREPO ROOT:
#   docker build -f apps/license-admin/Dockerfile \
#     --build-arg VITE_LICENSE_API_BASE_URL=https://api.neawaslic.top/api/v1 \
#     -t restora/license-admin .
#
# The image is nginx serving the built /dist tree. No server-side logic —
# the SPA calls the license-server's public API directly.

FROM node:22-bookworm-slim AS builder

RUN corepack enable

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc .pnpmfile.cjs turbo.json ./
COPY tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY apps/license-admin/package.json apps/license-admin/

RUN pnpm install --frozen-lockfile --filter @restora/license-admin...

COPY packages/config packages/config
COPY apps/license-admin apps/license-admin

# Baked at build time — Vite inlines import.meta.env.VITE_* into the bundle,
# so the runtime image doesn't need network config.
ARG VITE_LICENSE_API_BASE_URL=/api/v1
ENV VITE_LICENSE_API_BASE_URL=${VITE_LICENSE_API_BASE_URL}

RUN pnpm --filter @restora/license-admin run build

# ─── Stage 2: runtime — tiny nginx serving the dist/ bundle ───────────────
FROM nginx:1.27-alpine AS runtime

# SPA needs to fall through to index.html on client-side routes. Default
# nginx config 404s /login, /licenses/:id, etc. — override it.
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/license-admin/dist /usr/share/nginx/html

RUN <<'EOF' cat > /etc/nginx/conf.d/spa.conf
server {
  listen 80;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  # Long-cache hashed assets, no-cache the entry HTML so new deploys
  # are picked up immediately.
  location ~* \.(js|css|woff2|png|jpg|jpeg|svg|ico)$ {
    expires 1y;
    access_log off;
    add_header Cache-Control "public, immutable";
  }

  location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
  }
}
EOF

EXPOSE 80
