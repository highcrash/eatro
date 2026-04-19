# Install Guide

Three install paths. All three end with the install wizard at
`http(s)://yourdomain.com/admin/`.

> **TL;DR (Ubuntu 22.04 / 24.04):** three commands, fully automated.
>
> ```bash
> unzip restaurant-pos-v1.0.0.zip
> cd restaurant-pos-v1.0.0
> sudo bash install.sh
> ```
>
> The installer detects Docker if present; otherwise installs Node 22 +
> PostgreSQL 15+ + nginx + PM2, creates the DB with the right PG 15+
> schema perms, writes a random-secret `.env`, runs migrations, seeds
> the wizard sentinel row, drops an nginx config, starts the API under
> PM2, and prints the URL to visit. You'll be prompted for the DB
> password (auto-generated default) + domain (`_` for IP-only testing).

## 1) Automated installer (recommended)

See the TL;DR above. The script is `install.sh` at the root of the
extracted zip. Pass `--ubuntu` or `--docker` to force a path:

```bash
sudo bash install.sh --docker   # skip system Postgres, use the
                                # docker-compose stack + Caddy
sudo bash install.sh --ubuntu   # skip Docker even if it's installed
```

Works on Ubuntu 22.04, 24.04, 25.x, Debian 12. For other distros
(RHEL / Alpine / Arch), follow the manual path in section 3 below.

Re-running `install.sh` is safe — it reuses existing DB/users and
only re-applies config. The DB is never dropped.

## 2) Docker Compose (manual)

If you prefer to drive Docker yourself:

```bash
cd restaurant-pos-v1.0.0
cp .env.example .env
nano .env            # DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET
nano Caddyfile       # replace yourdomain.com with your real domain
docker compose up -d --build
docker compose logs -f api
```

Then visit `https://yourdomain.com/admin/` and walk the wizard.

## 3) Ubuntu manual (if the installer won't run)

If you're on an unusual distro or want to understand what the
installer does, here's the explicit sequence. Ubuntu 22.04 / 24.04 /
25.x assumed.

```bash
# 3.1 — Prereqs
sudo apt update
sudo apt install -y curl ca-certificates gnupg unzip nginx postgresql

# 3.2 — Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm pm2

# 3.3 — DB (PG 15+ needs the public-schema grants)
PG_PASS=$(openssl rand -base64 24 | tr -d '+/=' | head -c 24)
sudo -u postgres psql <<SQL
CREATE USER pos WITH PASSWORD '$PG_PASS';
CREATE DATABASE pos_prod OWNER pos;
\c pos_prod
GRANT ALL ON SCHEMA public TO pos;
ALTER SCHEMA public OWNER TO pos;
SQL

# 3.4 — App
sudo mkdir -p /opt/restaurant-pos && sudo chown $USER /opt/restaurant-pos
unzip restaurant-pos-v1.0.0.zip -d /tmp/pos-extract
cp -a /tmp/pos-extract/*/. /opt/restaurant-pos/
cd /opt/restaurant-pos
pnpm install --prod

cat > .env <<ENV
NODE_ENV=production
PORT=3001
DATABASE_URL="postgresql://pos:$PG_PASS@127.0.0.1:5432/pos_prod?schema=public"
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
ENV
chmod 600 .env

pnpm db:migrate
pnpm db:seed:empty

# 3.5 — nginx
sudo cp nginx-example.conf /etc/nginx/sites-available/restaurant-pos
sudo sed -i "s|\$INSTALL_DIR|/opt/restaurant-pos|g; s|yourdomain.com|_|" /etc/nginx/sites-available/restaurant-pos
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/restaurant-pos /etc/nginx/sites-enabled/restaurant-pos
sudo chmod -R o+rX /opt/restaurant-pos
sudo nginx -t && sudo systemctl reload nginx

# 3.6 — Run
pm2 start api/dist/main.js --name pos-api --cwd /opt/restaurant-pos
pm2 save
pm2 startup

# 3.7 — Verify
curl -I  http://$(hostname -I | awk '{print $1}')/admin/    # 200
curl     http://$(hostname -I | awk '{print $1}')/api/v1/health   # ok
```

## 4) cPanel (shared hosting)

Most cPanel hosts ship the **Node.js App Manager**. If yours has Node
22 and PostgreSQL, you can install without SSH-only access.

1. **Database** — cPanel → "PostgreSQL Databases" → create DB + user.
   After creating them, use phpPgAdmin or the cPanel SQL console to
   run `GRANT ALL ON SCHEMA public TO yourdbuser; ALTER SCHEMA public
   OWNER TO yourdbuser;` against the new database.
2. **Upload** — File Manager → upload the zip → Extract.
3. **Node app** — "Setup Node.js App":
   - Node version: 22
   - Application root: `/home/<you>/restaurant-pos-v1.0.0`
   - Application URL: `yourdomain.com`
   - Application startup file: `api/dist/main.js`
4. **Environment** — Add in the Node app's env-vars section (or edit
   `.env` via File Manager):
   - `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (use
     `openssl rand -base64 48` or an online secret generator)
5. **Install dependencies** — Click "Run NPM Install" in the Node app
   panel. It'll use pnpm if it sees `pnpm-lock.yaml`.
6. **Migrate + seed** — In the in-cPanel terminal:
   ```
   cd ~/restaurant-pos-v1.0.0
   pnpm db:migrate
   pnpm db:seed:empty
   ```
7. **Subdomain routing** — point `admin.yourdomain.com`,
   `pos.yourdomain.com`, etc to their matching `dist/` dirs via
   cPanel's subdomain manager.

## PostgreSQL setup

The automated `install.sh` already installs PostgreSQL 15+ on Ubuntu
and creates the `pos_prod` DB + `pos` user for you — this section is
for operators who want to use an existing Postgres server, a managed
service, or a different OS. Target: **PostgreSQL 15 or newer**
(14 and below will fail because we use features added in 15).

### Ubuntu 22.04 / 24.04 / 25.x

Ubuntu's default `postgresql` apt package is Postgres 14 on 22.04
and Postgres 16 on 24.04+. We need 15+; on 22.04 add the PGDG apt
repo to pull a newer major. **Install `postgresql-common` first** —
PGDG's per-version packages call `pg_lsclusters` in their postinst
hook, which ships in `postgresql-common`. Skip that install and the
postinst fails with `pg_lsclusters: not found`.

```bash
# 22.04 — add PGDG + pull Postgres 16
sudo apt install -y curl ca-certificates postgresql-common
# The PGDG helper adds the repo + keyring for you (more reliable
# than hand-rolling the curl | gpg | tee recipe):
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-16

# 24.04+ — default apt package is already Postgres 16, no PGDG needed
sudo apt install -y postgresql
```

If you already hit the `pg_lsclusters: not found` error, recover
with:

```bash
sudo apt install -y postgresql-common
sudo dpkg --configure -a       # completes the interrupted install
sudo systemctl enable --now postgresql
```

Start + enable:

```bash
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "SELECT version();"   # confirm 15+
```

### Debian 12

Same PGDG recipe — Debian's default is also often older than 15:

```bash
sudo apt install -y curl ca-certificates postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-16
```

### RHEL / Rocky / AlmaLinux 9

```bash
sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-$(arch)/pgdg-redhat-repo-latest.noarch.rpm
sudo dnf -qy module disable postgresql
sudo dnf install -y postgresql16-server postgresql16
sudo /usr/pgsql-16/bin/postgresql-16-setup initdb
sudo systemctl enable --now postgresql-16
```

### macOS (dev only)

```bash
brew install postgresql@16
brew services start postgresql@16
createdb pos_prod
```

### Create DB + user + PG 15+ grants

Once Postgres is running, create the app's user + database with the
**two public-schema grants** required on PG 15+. Skip these and
`prisma migrate deploy` dies with `permission denied for schema
public`.

```bash
# Pick a password — auto-generate one if you want:
PG_PASS=$(openssl rand -base64 24 | tr -d '+/=' | head -c 24)
echo "Generated DB password: $PG_PASS"

sudo -u postgres psql <<SQL
-- 1. Role (login + password)
CREATE USER pos WITH PASSWORD '$PG_PASS';

-- 2. Database owned by the new role
CREATE DATABASE pos_prod OWNER pos;

-- 3. PG 15+ public-schema grants — REQUIRED, don't skip
\c pos_prod
GRANT ALL ON SCHEMA public TO pos;
ALTER SCHEMA public OWNER TO pos;
SQL
```

Your `DATABASE_URL` is now:
```
postgresql://pos:THE_PASSWORD@127.0.0.1:5432/pos_prod?schema=public
```

### Remote Postgres / managed service

If you're using DigitalOcean Managed PG, AWS RDS, Supabase, Neon,
Railway, etc:

1. Create a database named something like `pos_prod` in the
   provider's console.
2. Grab the connection string — it'll look like
   `postgresql://user:pass@host:5432/db?sslmode=require`.
3. Append `&schema=public` if it's not already there.
4. Paste it into `.env` as `DATABASE_URL`.
5. If the provider gave you a user that's NOT the database owner,
   run the two `GRANT ALL ON SCHEMA public ... ALTER SCHEMA public
   OWNER TO ...` statements from the console's SQL runner against
   the new DB. Providers that hand you a superuser role (Railway,
   Neon) handle this implicitly.

SSL is required on most managed hosts — Prisma honors `sslmode` in
the URL so no extra config is needed.

### Firewall note

If Postgres is on a separate host from the API, make sure:
- Postgres's `postgresql.conf` has `listen_addresses = '*'` (or the
  API host's IP).
- `pg_hba.conf` has a line allowing the API host:
  `host pos_prod pos <api-ip>/32 scram-sha-256`.
- The OS firewall allows inbound 5432 from the API host only
  (never from `0.0.0.0/0`).

### Verifying the connection

Before running `pnpm db:migrate`, sanity-check from the API host:

```bash
apt install -y postgresql-client      # only the psql CLI; no server
psql "$DATABASE_URL" -c "SELECT 1;"
# → ?column?
#   ----------
#          1
```

If that hangs: Postgres isn't reachable (firewall, wrong host). If
it errors `FATAL: password authentication failed`: DB user or
password is wrong. If it errors `SSL required`: add `?sslmode=require`
to `DATABASE_URL`.

## URLs you end up with

| Path        | What                              |
| ----------- | --------------------------------- |
| `/`         | Public marketing website          |
| `/admin/`   | Admin dashboard + install wizard  |
| `/pos/`     | Touch POS terminal                |
| `/kds/`     | Kitchen display                   |
| `/qr/`      | QR self-order PWA                 |
| `/api/v1/*` | API (auto-proxied by nginx/Caddy) |

## License activation

The install wizard's second step prompts for your CodeCanyon
purchase code + domain. If activation fails, no other data is
written — the wizard stops and lets you retry or try a different
code. No purchase code + no clean bypass; the server-side install
won't mark itself complete without an active license.

If you ever need to re-activate (moved domains, revoked code,
replaced hardware), use the **License** page in the admin sidebar.

## Troubleshooting

See [docs/FAQ.md](FAQ.md) for product-level questions. Install-side
gotchas:

### `ETIMEDOUT` during `pnpm install`

Slow npmjs.org connection. pnpm retries automatically; on a slow
link the install just takes 5-10 minutes. If it keeps timing out,
raise the retry budget and timeout:

```bash
pnpm config set fetch-timeout 120000
pnpm config set fetch-retries 5
pnpm install
```

### `ERROR: permission denied for schema public` during migrate

PostgreSQL 15+ revoked the default CREATE privilege. Run:

```bash
sudo -u postgres psql -d pos_prod <<SQL
GRANT ALL ON SCHEMA public TO pos;
ALTER SCHEMA public OWNER TO pos;
SQL
pnpm db:migrate
```

### `Command "prisma" not found` / `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`

Old 0.x extract left in place. Delete `node_modules` +
`pnpm-lock.yaml`, re-extract the latest zip over it, re-run
`pnpm install`. The 1.0+ release ships `prisma` + `tsx` as
runtime deps and allowlists the git-hosted license client.

### Install wizard never appears — admin login shows instead

You extracted over an already-installed DB. Either start fresh:

```bash
pnpm prisma migrate reset   # drops everything
pnpm db:seed:empty
```

Or sign in with your existing owner credentials. The wizard only
appears when `system_config.installedAt IS NULL`.

### `pg_lsclusters: not found` during PostgreSQL install

You're trying to install a PGDG `postgresql-NN` package without the
`postgresql-common` helper that provides `pg_lsclusters`. PGDG's
postinst scripts call that tool on every install/upgrade; without
it, dpkg stops halfway through configuring the new cluster.

Fix + recover:

```bash
sudo apt install -y postgresql-common
sudo dpkg --configure -a          # finishes the interrupted postinst
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "SELECT version();"
```

Prevention: always install `postgresql-common` in the same
`apt install` as the per-version package — see the PostgreSQL
section above.

### Admin SPA loads but all pages are blank after login

Browser cached an older admin bundle from a partial install.
Hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R).

### "NO LICENSE — READ-ONLY MODE" banner won't go away after activation

Your install successfully activated, but the banner's polling
query cached the previous "missing" state for 60s. It'll clear on
the next refetch, or just refresh the admin page once.
