# Restora POS — DigitalOcean Deployment Guide

This document covers the **first-time deployment** of Restora POS to DigitalOcean App Platform. After this is set up, day-to-day deploys are just `git push` to `main`.

## Architecture

```
                          ┌──────────────────────────┐
   Internet ─────────────►│ DigitalOcean App Platform│
                          │                          │
                          │  ┌────────┐  ┌──────┐    │
                          │  │  API   │  │  DB  │    │   eatrobd.com (root)
                          │  │ (Nest) │◄─┤  PG  │    │   admin.eatrobd.com
                          │  └────────┘  └──────┘    │   pos.eatrobd.com
                          │                          │   kds.eatrobd.com
                          │  Static sites (CDN):     │   qr.eatrobd.com
                          │  • web (root domain)     │   order.eatrobd.com
                          │  • admin                 │   api.eatrobd.com
                          │  • pos                   │
                          │  • kds                   │
                          │  • qr                    │
                          │  • qr-order              │
                          └──────────────────────────┘
                                     │
                                     ▼
                          ┌──────────────────────────┐
                          │ DigitalOcean Spaces      │  uploads bucket
                          │ (S3-compatible storage)  │  (menu images, logos)
                          └──────────────────────────┘
```

---

## Prerequisites

- [x] DigitalOcean account with billing enabled
- [x] GitHub repository pushed (this repo)
- [x] Domain `eatrobd.com` registered and DNS configurable
- [x] `doctl` CLI installed (optional but recommended) — `brew install doctl` / `choco install doctl`

---

## Step 0 — Database: new or reuse existing?

You can either let App Platform provision a new managed Postgres ($15/mo) or **reuse an existing cluster** you're already paying for.

### Option A — Provision a new database (default)

Uncomment the `databases:` block in `.do/app.yaml` and uncomment the matching `DATABASE_URL` line that uses `${db.DATABASE_URL}`. App Platform will create the cluster and inject the connection string automatically.

### Option B — Reuse an existing cluster

1. Connect to your existing cluster (DO dashboard → Databases → your cluster → **Connection Details** copies a `psql` command).
2. Create a dedicated database + user for this app:
   ```sql
   CREATE DATABASE restora_pos;
   CREATE USER restora_user WITH ENCRYPTED PASSWORD 'pick-a-strong-password';
   GRANT ALL PRIVILEGES ON DATABASE restora_pos TO restora_user;
   \c restora_pos
   GRANT ALL ON SCHEMA public TO restora_user;
   ```
3. Build the connection string from the cluster's Connection Details, swapping in the new user + database:
   ```
   postgresql://restora_user:STRONG_PASSWORD@HOST:25060/restora_pos?sslmode=require
   ```
4. In `.do/app.yaml`, leave the `databases:` block commented out (it's the default now).
5. When creating the App in Step 3, you'll be prompted to set the `DATABASE_URL` secret — paste the connection string there.

⚠️ **Connection-pool warning:** dev-tier Postgres only allows ~22 simultaneous connections. Check your existing cluster's usage in **Databases → Insights → Connections**. If it's already busy, provision a new database instead — sharing a saturated cluster causes random `too many clients` errors.

---

## Step 1 — Create the DigitalOcean Spaces bucket

1. DO dashboard → **Spaces Object Storage** → **Create Spaces Bucket**
2. Region: **Singapore (SGP1)**
3. Name: `restora-uploads`
4. File listing: **Restricted**
5. CDN: enable (free, faster image loads)
6. Click **Create**

Then generate access keys:

1. **API → Spaces Keys → Generate New Key**
2. Name: `restora-pos`
3. Copy both the **Key** and **Secret** — you'll paste them into the App spec in Step 3.

---

## Step 2 — Push the code to GitHub

```bash
git add .
git commit -m "deploy: prepare for App Platform"
git push origin main
```

Make sure your repo is **public** OR you've connected the GitHub App to your DigitalOcean account so App Platform can access it.

---

## Step 3 — Create the App from spec

### Option A — via dashboard (easier first time)

1. DO dashboard → **Apps** → **Create App**
2. Source: **GitHub** → pick `restora-pos` repo, branch `main`
3. Click **Edit Your App Spec** → **Import from `.do/app.yaml`**
4. Edit `YOUR_GH_USER/restora-pos` → put your actual GitHub user/org/repo path (3 places: API + 6 static sites; or use find/replace)
5. **Set the secrets** (the `type: SECRET` env vars). You'll be prompted:
   - `JWT_SECRET` → generate a random 48-byte base64 string (commands below) and paste
   - `JWT_REFRESH_SECRET` → another fresh random string
   - `SPACES_KEY` → from Step 1
   - `SPACES_SECRET` → from Step 1
   - `SMS_API_KEY` → optional, your sms.net.bd key (or leave blank)
   - `DATABASE_URL` → only if reusing an existing cluster (Step 0 Option B)

   **Generate a random secret:**
   ```bash
   # Linux / macOS
   openssl rand -base64 48

   # Windows / cross-platform (Node — works anywhere)
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

   # Pure PowerShell (no Node needed)
   [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
   ```
6. Review → **Create Resources**

App Platform will provision the database, build the API + 6 static sites in parallel, and run them. First build takes 8–12 minutes.

### Option B — via doctl

```bash
doctl auth init
doctl apps create --spec .do/app.yaml
# After it shows the app ID, set the secrets:
doctl apps update <app-id> --spec .do/app.yaml
# (or set them through the dashboard which is faster)
```

---

## Step 4 — Configure DNS

In your domain registrar (where `eatrobd.com` is registered), add CNAME records pointing at App Platform:

| Subdomain | Type | Target |
|---|---|---|
| `@` (or `eatrobd.com`) | A or ALIAS | (App Platform's IP, shown in dashboard for the `web` static site) |
| `www` | CNAME | `eatrobd.com` |
| `admin` | CNAME | (App Platform hostname for the admin static site) |
| `pos` | CNAME | (App Platform hostname for the pos static site) |
| `kds` | CNAME | (App Platform hostname for the kds static site) |
| `qr` | CNAME | (App Platform hostname for the qr static site) |
| `order` | CNAME | (App Platform hostname for the qr-order static site) |
| `api` | CNAME | (App Platform hostname for the API service) |

The exact hostnames are visible in **App → Settings → Domains** for each component. App Platform will issue Let's Encrypt SSL certs automatically once DNS validates (1–10 minutes per domain).

---

## Step 5 — First database setup

The first deploy will:

1. Create the managed Postgres database
2. Run `pnpm prisma migrate deploy` automatically as the API's run command starts
3. Apply the `20260408000000_init` migration
4. Boot the API

You'll have an **empty database**. To create the OWNER login + initial branch + payment methods, run the seed script via the App Console:

1. DO dashboard → App → API service → **Console** tab
2. Run:
   ```bash
   pnpm prisma db seed
   ```
   *(or paste the seed SQL inline if you don't want to run the script)*

Default credentials are in `prisma/seed.ts`. Change them immediately after logging in.

---

## Step 6 — Verify

Visit each surface and confirm:

| URL | What to check |
|---|---|
| `https://api.eatrobd.com/api/v1/health` | Returns `{ "status": "ok" }` |
| `https://eatrobd.com` | Public marketing site loads, hero shows |
| `https://admin.eatrobd.com` | Admin login screen renders |
| `https://pos.eatrobd.com` | POS login screen renders |
| `https://kds.eatrobd.com` | KDS login screen renders |
| `https://qr.eatrobd.com/qr/<some-table-id>` | QR menu loads |
| `https://order.eatrobd.com/...` | QR order flow loads |

If anything 502s, check **App → Runtime Logs** for the API.

---

## Day-to-day workflow

```bash
# Make code changes locally
pnpm dev   # test locally

# When ready
git add .
git commit -m "feat: thing"
git push origin main

# Within 30 seconds, App Platform sees the push and:
#  1. Detects which components changed (only those rebuild)
#  2. Builds in parallel
#  3. Runs the new instance
#  4. Health-checks
#  5. Atomically swaps traffic
```

Watch progress in **App → Deployments** or with `doctl apps list-deployments <app-id>`.

If a deploy breaks: **App → Deployments → Rollback** (one-click revert to the previous build).

---

## Schema changes

Whenever you change `prisma/schema.prisma`:

```bash
# Locally
npx prisma migrate dev --name describe_change
git add prisma/migrations
git commit -m "db: describe change"
git push
```

The new migration runs automatically as part of the next API deploy (`prisma migrate deploy` is in the `run_command`).

**Never use `prisma db push` in production** — it bypasses the migration history.

---

## Cost summary

| Item | Plan | Monthly |
|---|---|---|
| API service | Basic XXS (512 MB) | $5 |
| 6× static sites | App Platform free tier | $0 |
| Managed Postgres | Dev (1 GB / 10 GB) | $15 |
| Spaces | 250 GB included | $5 |
| **Total** | | **$25** |

Scale up by editing `instance_size_slug` in `.do/app.yaml` and pushing.

---

## Troubleshooting

**API 503 / unhealthy on first boot**
Check **Runtime Logs**. Most common: `DATABASE_URL` not set (it should auto-inject from the `db` component) or migration failed.

**CORS error in browser**
The `CORS_ORIGINS` env var on the API service must list every frontend domain (comma-separated, no trailing slash). Update via dashboard → API → Settings → Environment Variables.

**Image upload returns broken URL**
`SPACES_*` env vars not set or wrong region. Verify by hitting `https://api.eatrobd.com/api/v1/upload/image` with a multipart upload — response should contain a Spaces URL like `https://restora-uploads.sgp1.digitaloceanspaces.com/uploads/<uuid>.jpg`.

**Deploy fails on `pnpm install`**
Make sure `packageManager: "pnpm@10.x"` is set in root `package.json` (it is). App Platform reads this to pick the right package manager.

**Frontend can't reach API in production**
Check the static site's `VITE_API_BASE_URL` env var matches the actual API domain. **It's a build-time variable**, so a frontend rebuild is required after changing it (push an empty commit or trigger a manual deploy).

---

## Backup / restore

DO managed Postgres has automatic daily snapshots on the **Production** plan. For the dev plan ($15) you should run manual backups:

```bash
doctl databases db get <db-id> | grep connection
pg_dump <connection> > backup-$(date +%Y%m%d).sql
```

Schedule this via a cronjob on a small VPS or your local machine.

To restore:
```bash
psql <connection> < backup-20260408.sql
```
