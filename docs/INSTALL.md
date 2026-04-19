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

Manual setup with Node 22 + Postgres 15 + PM2 + nginx.

```bash
# Prerequisites
sudo apt update
sudo apt install -y curl postgresql nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm pm2

# Database
sudo -u postgres psql <<SQL
CREATE USER pos WITH PASSWORD 'choose-a-strong-one';
CREATE DATABASE pos_prod OWNER pos;
SQL

# Install
sudo mkdir -p /opt/restaurant-pos && sudo chown $USER /opt/restaurant-pos
tar -xzf restaurant-pos-v1.0.0.zip -C /opt/restaurant-pos --strip-components=1
cd /opt/restaurant-pos
pnpm install --frozen-lockfile
cp .env.example .env
nano .env  # set DATABASE_URL=postgresql://pos:...@127.0.0.1:5432/pos_prod
pnpm prisma migrate deploy --schema prisma/schema.prisma
pnpm db:seed:empty

# Run
pm2 start api/dist/main.js --name pos-api
pm2 save
pm2 startup           # follow the printed instructions

# nginx + Let's Encrypt
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

See [docs/FAQ.md](FAQ.md) for common issues.
