# Restora External API — v1

Programmatic access to business data for the AI Marketing Agent platform (and any other future external consumer). Versioned at `/api/v1/external/*`, authenticated with API keys, scope-gated, branch-scoped via the key itself.

The internal staff JWT API at `/api/...` is unchanged and unrelated. This surface is intentionally narrow, stable, and additive-only.

---

## Quickstart

### 1. Get a key

OWNER signs into Restora Admin → **Integrations** → **Create API Key**.
- Pick a name (e.g. "Marketing AI — Production")
- Pick the scopes the consumer needs (see [Scopes](#scopes))
- Optionally set an expiry

The plaintext key is returned **once**:

```
rk_a3f2c8b1_VGhpc0lzQVNlY3JldEZvclRoZUFQSUtleVN5c3RlbQ
```

Store it immediately — Restora never displays the secret again. If lost, revoke and re-create.

### 2. Make a request

```bash
curl https://api.your-restora-host/api/v1/external/business/profile \
  -H "Authorization: Bearer rk_a3f2c8b1_VGhpc0lzQVNlY3JldEZvclRoZUFQSUtleVN5c3RlbQ"
```

### 3. Response envelope

Every response wraps its payload:

```json
{
  "data": { ... },
  "meta": {
    "branchId": "ckl1z...",
    "generatedAt": "2026-05-13T14:22:01.501Z",
    "currency": "BDT",
    "timezone": "Asia/Dhaka"
  }
}
```

Consumers should read `meta.currency` and `meta.timezone` before interpreting money / dates. Money fields elsewhere in `data` are in **minor units** (paisa for BDT, cents for USD) — never apply a currency symbol without `meta.currency`.

---

## Authentication

- **Format:** `rk_<prefix>_<secret>` (three underscore-separated segments, all required)
- **Header:** `Authorization: Bearer <key>`
- **Prefix:** 8 hex chars, unique, safe to log/display
- **Secret:** 32 random bytes, base64url encoded. Never logged. bcrypt(12) hash stored at rest
- **Rotation:** create a new key → swap consumers → revoke the old one
- **Revocation:** permanent. Revoked keys return `401`

Errors:
- `401 Missing Bearer token` — no `Authorization` header
- `401 Malformed API key` — wrong shape
- `401 Invalid API key` — prefix not found or secret mismatch
- `401 API key revoked` / `API key expired` — key was valid once
- `403 Missing scopes: ...` — caller lacks one or more required scopes

---

## Scopes

Each route requires one or more scopes. Scopes are AND-combined per route. Pick the minimum set when creating a key.

| Scope               | Grants                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `business:read`     | Identity, contact, branding, social, tax/VAT config                 |
| `reports:read`      | Sales, top-items, by-category, daily series, performance/COGS       |
| `finance:read`      | Expenses and derived P&L                                            |
| `inventory:read`    | Stock levels, daily consumption                                     |
| `menu:read`         | Menu items, categories, prices                                      |
| `customers:read`    | Customer aggregates and segment counts                              |
| `loyalty:read`      | Loyalty balances and program settings                               |
| `marketing:read`    | Campaign list                                                       |
| `marketing:write`   | Campaign creation (use sparingly — write scope)                     |
| `reviews:read`      | Review aggregates                                                   |

New scopes can be added later without breaking existing keys.

---

## Data contract conventions

- **Money:** integer minor units (paisa). Always read `meta.currency` before formatting.
- **Dates:** ISO 8601 with `Z` timezone. Daily windows are inclusive on both ends.
- **Branch scoping:** never pass `branchId` — the key already encodes it. Routes that accept a branch param exist only on internal staff APIs.
- **Versioning:** `/v1/external/*` is frozen for backwards compatibility. Breaking changes ship as `/v2/external/*`.
- **Additive changes** (new fields, new routes, new scopes) are not breaking.

---

## Endpoints (v1)

Authoritative list lives in Swagger at `/api/docs/external` once the separate doc is mounted. Stable contract:

| Route                                    | Scope             | Status     |
| ---------------------------------------- | ----------------- | ---------- |
| `GET /business/profile`                  | `business:read`   | shipped    |
| `GET /business/sales?period=`            | `reports:read`    | shipped    |
| `GET /business/sales/daily?days=`        | `reports:read`    | shipped    |
| `GET /business/sales/detail?from=&to=`   | `reports:read`    | shipped    |
| `GET /business/sales/top-items?limit=`   | `reports:read`    | shipped    |
| `GET /business/sales/by-category`        | `reports:read`    | shipped    |
| `GET /business/performance?from=&to=`    | `reports:read`    | shipped    |
| `GET /business/inventory`                | `inventory:read`  | shipped    |
| `GET /business/menu`                     | `menu:read`       | shipped    |
| `GET /business/customers`                | `customers:read`  | shipped    |
| `GET /business/customers/segment?...`    | `customers:read`  | shipped    |
| `GET /business/loyalty/summary`          | `loyalty:read`    | shipped    |
| `GET /business/marketing/campaigns`      | `marketing:read`  | shipped    |
| `GET /business/finance/expenses`         | `finance:read`    | shipped    |
| `GET /business/reviews`                  | `reviews:read`    | shipped    |
| `POST /business/marketing/campaigns`     | `marketing:write` | deferred   |
| `GET /business/finance/pnl`              | `finance:read`    | deferred   |

**Deferred routes** are listed because the contract is reserved — they will be added without a `/v2` bump. `POST /campaigns` is held until the audit-actor model for API-key-initiated writes is settled. `GET /finance/pnl` is held until P&L semantics (treatment of COGS, payroll, depreciation) are explicit.

---

## Extending the API

To add a new route:

1. Add the scope to `apps/api/src/external-api/dto/api-scope.const.ts` if it's new
2. Delegate to an existing service (don't reimplement aggregation)
3. Annotate the route with `@Scopes(...)` and the matching `@ApiOperation`
4. Wrap the response in `{ data, meta }` via `ExternalService.getBranchMetaContext`
5. Update this README's endpoint table

Breaking changes (renaming a field, removing a route, changing money units) require a `/v2/external/*` namespace.
