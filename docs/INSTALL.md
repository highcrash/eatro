# Install Guide

Three install paths. All three end with the install wizard at
`https://yourdomain.com/admin`.

## 1) Docker (recommended for VPS)

Easiest if your VPS already has Docker. The bundled compose brings up
the API, all SPAs, Postgres, and Caddy with auto-TLS.

```bash
# 1. Extract the zip somewhere persistent
sudo mkdir -p /opt/restaurant-pos && sudo chown $USER /opt/restaurant-pos
tar -xzf restaurant-pos-v1.0.0.zip -C /opt/restaurant-pos --strip-components=1
cd /opt/restaurant-pos

# 2. Edit env: DB credentials, JWT secrets, Caddyfile domain
cp .env.example .env
nano .env           # set DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
nano Caddyfile      # replace yourdomain.com with your real domain

# 3. Start
docker compose up -d --build
docker compose logs -f api
```

Then visit `https://yourdomain.com/admin` and walk the install wizard.

## 2) Ubuntu VPS without Docker

Manual setup with Node 22 + Postgres 15 + PM2 + nginx. Run each block
in order. Ubuntu 22.04 / 24.04 assumed.

### 2.1 — Base tools + remove any stale Node

Ubuntu's default `nodejs` package is Node 20; installing it in the
same line as Postgres + nginx will leave you on Node 20 and pnpm
will warn about the engine mismatch. Wipe any pre-existing Node
first, then install from NodeSource to get Node 22.

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg unzip postgresql nginx
# Remove any older Node that came in via apt (safe even if none is installed).
sudo apt remove -y nodejs npm libnode-dev libnode72 || true
sudo apt autoremove -y
```

### 2.2 — Install Node 22 from NodeSource

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
# Verify — both should print a version:
node -v          # expect v22.x
npm -v           # expect 10.x (shipped with Node 22)
```

If `node -v` still says v20.x, the NodeSource repo wasn't picked up.
Re-run the `curl ... nodesource.com ...` line — it adds the apt
source — and re-run `apt install -y nodejs`.

### 2.3 — Install pnpm + PM2

```bash
sudo npm install -g pnpm pm2
pnpm -v          # expect 10.x
```

### 2.4 — Database

```bash
sudo -u postgres psql <<SQL
CREATE USER pos WITH PASSWORD 'choose-a-strong-one';
CREATE DATABASE pos_prod OWNER pos;
SQL
```

### 2.5 — Extract + install the app

The release is a **zip** (not a tarball), so use `unzip`. Adjust the
version in the file name.

```bash
sudo mkdir -p /opt/restaurant-pos && sudo chown $USER /opt/restaurant-pos
unzip restaurant-pos-v1.0.0.zip -d /tmp/pos-extract
# The zip contains one top-level directory; move its contents up.
mv /tmp/pos-extract/*/.* /tmp/pos-extract/*/* /opt/restaurant-pos/ 2>/dev/null || true
mv /tmp/pos-extract/*/* /opt/restaurant-pos/
rm -rf /tmp/pos-extract

cd /opt/restaurant-pos
pnpm install --prod    # `prisma` + `tsx` are runtime deps so --prod works
cp .env.example .env
nano .env              # DATABASE_URL=postgresql://pos:CHOSEN_PW@127.0.0.1:5432/pos_prod
                       # JWT_SECRET + JWT_REFRESH_SECRET — generate with:
                       #   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
pnpm db:migrate        # → prisma migrate deploy --schema prisma/schema.prisma
pnpm db:seed:empty     # or db:seed:demo-light if you want sample data
```

### 2.6 — Run with PM2

```bash
pm2 start api/dist/main.js --name pos-api
pm2 save
pm2 startup               # copy + run the line it prints to make PM2 survive reboot
```

### 2.7 — Reverse-proxy + TLS

```bash
sudo cp infra/nginx-example.conf /etc/nginx/sites-available/pos
sudo ln -sf /etc/nginx/sites-available/pos /etc/nginx/sites-enabled/pos
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## 3) cPanel (shared hosting)

Most cPanel hosts ship the **Node.js App Manager**. If yours has Node
22 and PostgreSQL, you can install without SSH-only access.

1. **Database** — In cPanel → "PostgreSQL Databases", create a DB +
   user. Note the connection string format your host provides.
2. **Upload** — File Manager → upload the zip → Extract.
3. **Node app** — "Setup Node.js App":
   - Node version: 22
   - Application root: `/home/<you>/restaurant-pos`
   - Application URL: `yourdomain.com`
   - Application startup file: `api/dist/main.js`
4. **Environment** — Add the env vars from `.env.example` in the Node
   app's environment-variables section.
5. **Install dependencies** — In the Node app panel, click "Run NPM
   Install" (it'll use pnpm if it sees `pnpm-lock.yaml`).
6. **Migrate + seed** — Open the in-cPanel terminal, `cd` into the
   app, `pnpm prisma migrate deploy --schema prisma/schema.prisma &&
   pnpm db:seed:empty`.
7. **Subdomains for SPAs** — point `admin.yourdomain.com`,
   `pos.yourdomain.com`, etc to the matching `dist/` directories via
   cPanel's subdomain manager (each pointing at the SPA's folder
   in your install).

## License activation

After the install wizard finishes you'll land on the login page. Sign
in as the owner you just created, then visit **Settings → License**
and paste your CodeCanyon purchase code + your domain. The system
verifies against the license server and unlocks mutations.

If you skip activation, all GET endpoints work but POST/PUT/PATCH
return `503 LICENSE_LOCKED` until you activate.

## Troubleshooting

See [docs/FAQ.md](FAQ.md) for product-level questions. Common install
problems below.

### `ETIMEDOUT` / `Request took 14000ms` during `pnpm install`

Your server can reach npmjs.org but the connection is slow or
flaky — common on new VPS instances, behind corporate firewalls,
or in regions far from npm's CDN. pnpm retries three times and
usually succeeds; the install just takes 5–10 minutes instead of
30 seconds. If retries exhaust, raise the timeout + retry budget:

```bash
pnpm config set fetch-timeout 120000
pnpm config set fetch-retries 5
pnpm install
```

If you're in a region where npmjs.org is heavily rate-limited,
point pnpm at a mirror:

```bash
# Cloudflare-backed mirror (good global latency):
pnpm config set registry https://registry.npmmirror.com/
pnpm install
# revert to npmjs.org after the install:
pnpm config set registry https://registry.npmjs.org/
```

### `Command "prisma" not found` after install

Your lockfile + package.json are from an older release that had
`prisma` in devDependencies. Delete `node_modules` + `pnpm-lock.yaml`
from your install dir, re-extract the latest zip over it, and re-run
`pnpm install`. The 1.0.0+ zip has `prisma` and `tsx` in
dependencies so they're always installed.

### `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` for `@restora/license-client`

Same lockfile-is-stale cause as above. The 1.0.0+ `package.json`
allowlists `@restora/license-client` in `pnpm.onlyBuiltDependencies`
so its `prepare: tsc` hook runs. Re-extract the latest zip.

### "Build scripts are not allowed" for several other packages

pnpm 10 added a safety default that blocks postinstall scripts
unless the package is allowlisted. The zip's root `package.json`
already lists the ones we use (prisma, esbuild, bcrypt, etc). If
you add custom deps that need build scripts, append them to
`pnpm.onlyBuiltDependencies` before re-running install.

### Install-wizard never appears — admin login shows instead

You extracted over an already-installed DB. Either start fresh
(`pnpm prisma migrate reset` → `pnpm db:seed:empty`), or sign in
with your existing owner credentials. The wizard only appears when
`system_config.installedAt IS NULL`.
