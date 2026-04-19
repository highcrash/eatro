# Development

For buyers who want to fork + customise the product.

## Layout

```
apps/
  api/         NestJS API + Prisma
  admin/       React + Vite — admin dashboard
  pos/         React + Vite — POS terminal
  kds/         React + Vite — kitchen display
  qr-order/    React + Vite — QR self-order PWA
  web/         React + Vite — public website
  pos-desktop/ Electron app (separate license; ignored on web-only edition)
packages/
  config/      Shared eslint/tsconfig/prettier
  types/       Shared TypeScript types (DTO contracts)
  utils/       Pure helper functions
prisma/
  schema.prisma + migrations + seeds
docs/          You are here
infra/         Deploy templates (docker-compose, Caddy, nginx)
scripts/       One-shot tools (codecanyon packager, codemod)
```

## Prerequisites

- Node 22.x
- pnpm 10.x (`npm install -g pnpm`)
- Postgres 15
- Optional: Docker Desktop for the local Postgres container

## Local dev

```bash
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
nano apps/api/.env   # DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET

# Start Postgres + Redis (docker)
docker compose -f infra/docker-compose.yml up -d

# Migrate + seed
pnpm prisma migrate dev
pnpm db:seed:demo-light

# Start everything
pnpm dev               # API + all SPAs
# or just one:
pnpm dev:api
pnpm dev:admin
```

API on `http://localhost:3001`, admin on `http://localhost:5173`,
POS on `:5174`, KDS on `:5175`, QR-order on `:5176`, web on `:5177`.

## Where to make changes

| Want to change | Edit |
| -------------- | ---- |
| API endpoint behaviour | `apps/api/src/<feature>/...service.ts` |
| New API endpoint | Add a controller under `apps/api/src/<feature>/` and import its module in `app.module.ts` |
| Admin page | `apps/admin/src/pages/<Page>.tsx` |
| Theme / branding default | `apps/admin/src/styles/branding.css` (preserved across updates) |
| DB schema | `prisma/schema.prisma` → `pnpm prisma migrate dev --name your_change` |

## Customisations that survive updates

The buyer-zip update path (Settings → Updates) overwrites everything
in `api/dist`, `admin/`, `pos/`, etc. To keep mods:

1. Fork the source repo (you own a copy after purchase).
2. Apply your changes on a feature branch.
3. Pull upstream releases into your fork via merge.
4. Run `pnpm codecanyon:package` from your fork to produce your
   own zip.

DB-level data (themes, custom payment methods, etc) survives all
update paths.

## Tests

```bash
pnpm test              # all workspaces
pnpm --filter @restora/api test
```

End-to-end install + license flow tests live in
`apps/api/test/license.e2e-spec.ts` and `install.e2e-spec.ts`.
