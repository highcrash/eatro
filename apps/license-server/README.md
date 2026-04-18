# @restora/license-server

Self-hosted license server. Product-agnostic — currently serves the Restora POS
CodeCanyon edition and is designed to host licenses for future products too.

## Scope

- Verifies CodeCanyon purchase codes on activation.
- Binds each activation to a `domain` + `fingerprint` pair (web edition) or to
  a machine ID (desktop edition).
- Signs short-lived ed25519 "proofs" that installed clients verify offline for
  up to 7 days without network.
- Admin UI (separate app at `apps/license-admin/`) manages products, purchase
  codes, licenses, and audit logs.

## Relationship to the rest of the monorepo

This app is on the `main` branch (deploys to `license.eatrobd.com`) — it is
NOT part of the `codecanyon` sellable fork. The CodeCanyon edition's installed
copies call **into** this server via `packages/license-client`.

See the plan in [clever-wibbling-biscuit](../../codecanyon/docs/BRANCH_HYGIENE.md)
and Section 2 of the CodeCanyon fork design.

## Running locally

```bash
# 1. Configure env
cp apps/license-server/.env.example apps/license-server/.env
# edit .env — fill LICENSE_DB_URL (separate DB!), generate secrets

# 2. Create + migrate the license-server DB
pnpm db:license:migrate

# 3. Generate the Prisma client (writes to src/generated/prisma-license/)
pnpm db:license:generate

# 4. Run
pnpm dev:license
# → http://localhost:3002/api/v1/health
```

## Why a separate DB?

Envato reviewers and buyers expect the app to keep working during network
blips. The license server survives a main-API DB outage and vice versa only
if they don't share storage. Same cluster, separate logical DB is fine in
a pinch — but not the same schema.

## Ports

| Port | Service                                       |
|------|-----------------------------------------------|
| 3001 | Restora POS main API (`apps/api`)             |
| 3002 | **License server** (this app)                 |
| 5178 | License admin UI (`apps/license-admin`) — TBD |

## What's here vs. what's coming

Scaffold + health check + Prisma schema land in the first commit.
Crypto / public endpoints / admin API / signing-key rotation / Envato
import arrive in subsequent commits. See the root plan.
