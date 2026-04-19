#!/usr/bin/env node
// scripts/package-codecanyon.mjs — build the buyer's zip.
//
// Pipeline:
//   1. Sanity: refuse to run on any branch but `codecanyon`.
//   2. `pnpm install --frozen-lockfile` + `turbo run build`.
//   3. Stage release/<name>-vX.Y.Z/ with:
//        api/         apps/api/dist + prod node_modules + prisma
//        admin/, pos/, kds/, qr-order/, web/   each apps/<x>/dist
//        prisma/      schema + migrations + seed dispatcher
//        docs/        codecanyon-landing.html + the docs/*.md
//        infra/       buyer-deploy compose + nginx + caddy templates
//        manifest.json, manifest.sig (signed)
//        docker-compose.yml, install.sh, README.md, LICENSE.txt, .env.example
//   4. Run scripts/strip-branding.mjs --check on the staged tree
//      → fail build if any internal brand string snuck through.
//   5. Run scripts/lib/secret-scan.mjs on the staged tree → same.
//   6. Sign the manifest (scripts/lib/sign-manifest.mjs).
//   7. Zip the staging dir → release/<name>-vX.Y.Z.zip.
//
// Output goes under release/ (gitignored). Re-running is safe — the
// stage dir is rm'd up front.
//
// Skip a stage with --skip-build / --skip-scan etc for fast iteration.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const args = new Set(process.argv.slice(2));
const skip = (k) => args.has(`--skip-${k}`);

function step(label, fn) {
  console.log(`\n──── ${label} ────`);
  return fn();
}

function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function shJson(cmd) {
  return JSON.parse(execSync(cmd, { cwd: ROOT, encoding: 'utf8' }));
}

step('preflight', () => {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  if (branch !== 'codecanyon') {
    console.error(`refuse to package: current branch is "${branch}", expected "codecanyon"`);
    console.error('git checkout codecanyon, then re-run.');
    process.exit(2);
  }
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  global.__VERSION__ = rootPkg.version;
  global.__NAME__ = rootPkg.name;
  console.log(`branch=${branch}  name=${rootPkg.name}  version=${rootPkg.version}`);
});

const RELEASE_NAME = `${global.__NAME__}-v${global.__VERSION__}`;
const STAGE = join(ROOT, 'release', RELEASE_NAME);
const ZIP = join(ROOT, 'release', `${RELEASE_NAME}.zip`);

step('clean release dir', () => {
  if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
  if (existsSync(ZIP)) rmSync(ZIP, { force: true });
  mkdirSync(STAGE, { recursive: true });
});

if (!skip('build')) {
  step('install + build', () => {
    sh('pnpm install --frozen-lockfile');
    sh("pnpm exec turbo run build --filter=!@restora/pos-desktop");
  });
}

if (!skip('strip')) {
  step('strip-branding (working tree, before stage)', () => {
    sh('node scripts/strip-branding.mjs --check');
  });
}

step('stage app artefacts', () => {
  // API runtime: dist + the workspace package.json (so pnpm prod-deploy
  // can install just what the API needs at install time).
  cpSync(join(ROOT, 'apps/api/dist'), join(STAGE, 'api/dist'), { recursive: true });
  cpSync(join(ROOT, 'apps/api/package.json'), join(STAGE, 'api/package.json'));

  // Static SPAs — each their own dist.
  for (const app of ['admin', 'pos', 'kds', 'qr-order', 'web']) {
    cpSync(join(ROOT, `apps/${app}/dist`), join(STAGE, app), { recursive: true });
  }

  // Prisma schema + migrations + seeds.
  cpSync(join(ROOT, 'prisma/schema.prisma'), join(STAGE, 'prisma/schema.prisma'));
  cpSync(join(ROOT, 'prisma/migrations'), join(STAGE, 'prisma/migrations'), { recursive: true });
  cpSync(join(ROOT, 'prisma/seed.ts'), join(STAGE, 'prisma/seed.ts'));
  cpSync(join(ROOT, 'prisma/seeds'), join(STAGE, 'prisma/seeds'), { recursive: true });

  // Docs.
  cpSync(join(ROOT, 'docs'), join(STAGE, 'docs'), { recursive: true });

  // Build the buyer's root package.json by LIFTING the API workspace's
  // prod deps to the root. The buyer runs ONE `pnpm install` at root —
  // no workspace, no filters, no surprises.
  const apiPkg = JSON.parse(readFileSync(join(ROOT, 'apps/api/package.json'), 'utf8'));
  const liftedDeps = { ...apiPkg.dependencies };

  // Workspace deps (`workspace:*`) don't resolve outside the monorepo.
  // The API's dist/ keeps require() calls to `@restora/types` and
  // `@restora/utils` — nest build does NOT bundle them — so we SHIP
  // the packages inside the zip and rewrite each workspace entry to a
  // `file:` reference pnpm resolves at install time.
  //
  // Earlier commits wrongly assumed nest bundled these and deleted the
  // entries, which left the buyer's `node dist/main.js` crashing with
  // MODULE_NOT_FOUND on @restora/types.
  const shippedWorkspacePkgs = [];
  for (const k of Object.keys(liftedDeps)) {
    if (typeof liftedDeps[k] === 'string' && liftedDeps[k].startsWith('workspace:')) {
      if (k === '@restora/license-client') {
        // This one's special: it lives in the neawaslic repo, consumed
        // via git+URL. The apps/api/package.json already references it
        // that way, so this branch is only hit if a future monorepo
        // refactor re-adds it as workspace:*.
        delete liftedDeps[k];
      } else if (k.startsWith('@restora/')) {
        const localName = k.slice('@restora/'.length);
        const localDir = `packages/${localName}`;
        cpSync(join(ROOT, localDir), join(STAGE, localDir), {
          recursive: true,
          filter: (src) => !src.includes('node_modules'),
        });
        // A shipped workspace package may itself depend on other
        // workspace packages (e.g. utils → types). Rewrite the nested
        // package.json so those refs become file: too — pnpm will then
        // link the sibling packages/ directory at install time instead
        // of trying to resolve them in the (non-existent) workspace.
        const innerPkgPath = join(STAGE, localDir, 'package.json');
        const innerPkg = JSON.parse(readFileSync(innerPkgPath, 'utf8'));
        // Rewrite runtime workspace: refs to file: so pnpm links the
        // sibling packages/ dirs we also shipped. devDependencies are
        // not needed in a buyer's install (no rebuilds happen here),
        // and keeping workspace:*/file: refs for stuff we didn't ship
        // (like @restora/config, which is eslint+tsconfig only) would
        // break the install — so drop devDependencies outright.
        delete innerPkg.devDependencies;
        delete innerPkg.scripts;
        if (innerPkg.dependencies) {
          for (const dk of Object.keys(innerPkg.dependencies)) {
            if (typeof innerPkg.dependencies[dk] === 'string' && innerPkg.dependencies[dk].startsWith('workspace:')) {
              if (dk.startsWith('@restora/')) {
                innerPkg.dependencies[dk] = `file:../${dk.slice('@restora/'.length)}`;
              } else {
                delete innerPkg.dependencies[dk];
              }
            }
          }
        }
        writeFileSync(innerPkgPath, JSON.stringify(innerPkg, null, 2));
        liftedDeps[k] = `file:./${localDir}`;
        shippedWorkspacePkgs.push(localName);
      } else {
        delete liftedDeps[k];
      }
    }
  }
  if (shippedWorkspacePkgs.length) {
    console.log(`  shipped workspace packages: ${shippedWorkspacePkgs.join(', ')}`);
  }
  writeFileSync(
    join(STAGE, 'package.json'),
    JSON.stringify(
      {
        name: global.__NAME__,
        version: global.__VERSION__,
        private: true,
        engines: { node: '22.x' },
        scripts: {
          start: 'node api/dist/main.js',
          'db:migrate': 'prisma migrate deploy --schema prisma/schema.prisma',
          'db:seed:empty': 'tsx prisma/seed.ts --variant empty',
          'db:seed:demo-light': 'tsx prisma/seed.ts --variant demo-light',
        },
        dependencies: liftedDeps,
        // Whitelist the build-script-running deps so pnpm 10 doesn't
        // skip them on install. Two categories here:
        //   1. Normal deps with postinstalls (prisma downloads the
        //      query engine; nestjs-core registers decorators; etc).
        //   2. `@restora/license-client` — git-hosted dep with a
        //      `prepare: tsc` hook. pnpm 10 blocks git-dep build
        //      scripts by default, so the install fails with
        //      "needs to execute build scripts but is not in the
        //      onlyBuiltDependencies allowlist". Adding it here
        //      unblocks the tsc run that produces dist/.
        pnpm: {
          onlyBuiltDependencies: [
            '@nestjs/core',
            '@prisma/client',
            '@prisma/engines',
            '@restora/license-client',
            'bcrypt',
            'esbuild',
            'msgpackr-extract',
            'prisma',
          ],
        },
      },
      null,
      2,
    ),
  );

  cpSync(join(ROOT, '.env.example'), join(STAGE, '.env.example'));
});

step('write deploy templates', () => {
  // Buyer-facing docker-compose.yml — Postgres + Caddy + a `node`
  // service that runs the API. All SPAs are static files served by
  // Caddy. Tiny on-purpose; buyer can extend.
  writeFileSync(
    join(STAGE, 'docker-compose.yml'),
    `# Buyer-deploy docker-compose. Brings up:
#   - api      (NestJS, port 3001 inside the network)
#   - postgres (15-alpine, internal)
#   - caddy    (TLS termination on :80/:443)
# Edit DOMAIN below + fill .env, then \`docker compose up -d --build\`.
name: restaurant-pos
services:
  api:
    image: node:22-bookworm-slim
    working_dir: /app
    volumes: [./:/app]
    env_file: [./.env]
    command: sh -c "node api/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma && node api/dist/main.js"
    expose: ["3001"]
    depends_on: { postgres: { condition: service_healthy } }
    restart: unless-stopped
  postgres:
    image: postgres:15-alpine
    env_file: [./.env]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER} -d \${POSTGRES_DB}"]
      interval: 10s
      retries: 10
    restart: unless-stopped
  caddy:
    image: caddy:2-alpine
    ports: ["80:80","443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on: [api]
    restart: unless-stopped
volumes: { pgdata: {}, caddy-data: {} }
`,
  );

  writeFileSync(
    join(STAGE, 'Caddyfile'),
    `# Replace yourdomain.com with your real domain BEFORE first start.
# Caddy auto-issues Let's Encrypt certs once DNS points here.
# This Caddyfile is for the DOCKER deploy (paths are container-side
# at /srv/*). For Ubuntu+nginx (no Docker), use nginx-example.conf
# in this same directory.

yourdomain.com {
  encode zstd gzip
  # Static SPAs — each served from its own subpath.
  handle_path /admin* { root * /srv/admin; try_files {path} /index.html; file_server }
  handle_path /pos*   { root * /srv/pos;   try_files {path} /index.html; file_server }
  handle_path /kds*   { root * /srv/kds;   try_files {path} /index.html; file_server }
  handle_path /qr*    { root * /srv/qr-order; try_files {path} /index.html; file_server }
  # API + WebSocket — Nest listens on :3001.
  handle /api/* { reverse_proxy api:3001 }
  handle /socket.io/* { reverse_proxy api:3001 }
  # Public website at root /.
  handle { root * /srv/web; try_files {path} /index.html; file_server }
}
`,
  );

  writeFileSync(
    join(STAGE, 'nginx-example.conf'),
    `# nginx site config for the Ubuntu (non-Docker) install path.
# Copy to /etc/nginx/sites-available/restaurant-pos and symlink into
# sites-enabled. Edit \\$INSTALL_DIR + server_name for your install.
#
#   sudo cp nginx-example.conf /etc/nginx/sites-available/restaurant-pos
#   # — edit paths + server_name —
#   sudo ln -sf /etc/nginx/sites-available/restaurant-pos \\
#               /etc/nginx/sites-enabled/restaurant-pos
#   sudo rm -f /etc/nginx/sites-enabled/default
#   sudo nginx -t && sudo systemctl reload nginx
#
# Then add HTTPS with:
#   sudo apt install certbot python3-certbot-nginx
#   sudo certbot --nginx -d yourdomain.com

server {
    listen 80;
    server_name yourdomain.com;       # ← change to your domain (or _)

    # Edit this to where you extracted the zip.
    set \\$INSTALL_DIR /opt/restaurant-pos;

    client_max_body_size 25M;

    # API + WebSocket → Nest on :3001.
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\$scheme;
    }
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \\$host;
    }

    # Bare /admin /pos /kds /qr without trailing slash → redirect.
    # nginx does NOT auto-add the slash for alias-based locations
    # (only for root-based ones), so without these the buyer hits
    # 404 unless they remember to type the trailing slash.
    location = /admin { return 301 /admin/; }
    location = /pos   { return 301 /pos/; }
    location = /kds   { return 301 /kds/; }
    location = /qr    { return 301 /qr/; }

    # Admin dashboard at /admin.
    location /admin/ {
        alias \\$INSTALL_DIR/admin/;
        try_files \\$uri \\$uri/ /admin/index.html;
    }
    # POS terminal at /pos.
    location /pos/ {
        alias \\$INSTALL_DIR/pos/;
        try_files \\$uri \\$uri/ /pos/index.html;
    }
    # Kitchen display at /kds.
    location /kds/ {
        alias \\$INSTALL_DIR/kds/;
        try_files \\$uri \\$uri/ /kds/index.html;
    }
    # QR self-order PWA at /qr.
    location /qr/ {
        alias \\$INSTALL_DIR/qr-order/;
        try_files \\$uri \\$uri/ /qr/index.html;
    }
    # Public website at /.
    location / {
        root \\$INSTALL_DIR/web;
        try_files \\$uri \\$uri/ /index.html;
    }
}
`,
  );

  writeFileSync(
    join(STAGE, 'install.sh'),
    `#!/usr/bin/env bash
# One-shot installer. Handles the full Ubuntu 22.04 / 24.04 / 25.x
# bootstrap AND the Docker Compose path. Autodetects which one fits.
#
# Usage (from inside the extracted zip dir):
#   sudo bash install.sh            # interactive
#   sudo bash install.sh --docker   # force Docker Compose path
#   sudo bash install.sh --ubuntu   # force Ubuntu + nginx + PM2 path
#
# Requires root (for apt, nginx config, systemd, postgres). Run via
# sudo or as root directly.

set -euo pipefail

# Print what step failed + its exit code so buyers can paste a
# usable error instead of a silent exit back to the shell.
trap 'rc=\$?; printf "\\n\${RED:-}✗ install.sh failed at line \$LINENO (exit \$rc)\${NC:-}\\n  Paste the last screen to support.\\n" >&2' ERR

# ─── styling ──────────────────────────────────────────────────────────
RED='\\033[0;31m'; GRN='\\033[0;32m'; YLW='\\033[0;33m'; BLU='\\033[0;34m'; NC='\\033[0m'
die()  { printf "\${RED}✗\${NC} %s\\n" "\$*" >&2; exit 1; }
info() { printf "\${BLU}→\${NC} %s\\n" "\$*"; }
ok()   { printf "\${GRN}✓\${NC} %s\\n" "\$*"; }
warn() { printf "\${YLW}!\${NC} %s\\n" "\$*"; }

# Tee every step's output to a log so buyers can send us the whole
# session if something breaks. Also unmutes apt so they see progress.
LOG="/var/log/restaurant-pos-install.log"
mkdir -p "\$(dirname \$LOG)"
echo "=== install.sh \$(date -u --iso-8601=seconds) ===" >> "\$LOG"

[ "\$(id -u)" -eq 0 ] || die "Run as root (or use \\\`sudo bash install.sh\\\`)."

INSTALL_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
cd "\$INSTALL_DIR"

# ─── mode detection ───────────────────────────────────────────────────
MODE=""
for arg in "\$@"; do
  case "\$arg" in
    --docker) MODE="docker" ;;
    --ubuntu) MODE="ubuntu" ;;
    -h|--help) grep '^# ' "\$0" | sed 's/^# //'; exit 0 ;;
  esac
done

if [ -z "\$MODE" ]; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    info "Detected Docker — defaulting to Docker Compose path (\\\`--ubuntu\\\` to override)."
    MODE="docker"
  else
    info "No Docker — using the Ubuntu + nginx + PostgreSQL + PM2 path."
    MODE="ubuntu"
  fi
fi

# ═══════════════════════ DOCKER PATH ═════════════════════════════════
if [ "\$MODE" = "docker" ]; then
  [ -f .env ] || { cp .env.example .env; warn "Created .env from template — edit DATABASE_URL / JWT_* BEFORE re-running."; exit 0; }
  info "Starting docker compose stack (API + Postgres + Caddy)…"
  docker compose up -d --build
  ok "Stack is up. Visit https://\\\$(grep -E '^[^#].*neawaslic.top|^[^#].*yourdomain' Caddyfile | head -1 | awk '{print \\\$1}')/admin"
  exit 0
fi

# ═══════════════════════ UBUNTU PATH ═════════════════════════════════
# Everything below only runs for the no-Docker install.

if ! command -v apt-get >/dev/null 2>&1; then
  die "This script only handles Ubuntu / Debian-family systems. For other OSes, follow docs/INSTALL.md manually."
fi

info "Collecting config. Press ENTER to accept the bracketed default."
read -rp "DB password to set for user 'pos' [auto-generated]: " PG_PASSWORD
: "\${PG_PASSWORD:=\$(openssl rand -base64 24 | tr -d '+/=' | head -c 24)}"
read -rp "Your domain (or _ for IP-only testing) [_]: " DOMAIN
: "\${DOMAIN:=_}"

JWT1="\$(openssl rand -base64 48 | tr -d '\\n')"
JWT2="\$(openssl rand -base64 48 | tr -d '\\n')"

# ─── 1. base packages + PostgreSQL 15+ ───────────────────────────────
info "Installing base tools (apt)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update 2>&1 | tee -a "\$LOG" | tail -3
apt-get install -y ca-certificates curl gnupg unzip nginx openssl lsb-release postgresql-common 2>&1 | tee -a "\$LOG" | tail -3

# PostgreSQL: default apt on Ubuntu 22.04 is Postgres 14 which our
# migrations refuse (we need 15+). Detect Ubuntu codename and, if
# needed, add the PGDG apt repo BEFORE installing postgresql.
# postgresql-common is pre-installed above so PGDG per-version
# postinst hooks (which call pg_lsclusters) don't fail.
UBUNTU_CODENAME="\$(lsb_release -cs 2>/dev/null || echo unknown)"
info "Distro codename: \$UBUNTU_CODENAME"
if [ "\$UBUNTU_CODENAME" = "jammy" ] || [ "\$UBUNTU_CODENAME" = "bullseye" ]; then
  info "Adding PGDG repo for Postgres 16 (default is 14 on \$UBUNTU_CODENAME)…"
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y 2>&1 | tee -a "\$LOG" | tail -3
  apt-get install -y postgresql-16 2>&1 | tee -a "\$LOG" | tail -3
else
  info "Installing distro-default postgresql…"
  apt-get install -y postgresql 2>&1 | tee -a "\$LOG" | tail -3
fi
systemctl enable --now postgresql 2>&1 | tee -a "\$LOG" | tail -2

# Sanity: refuse to continue on PG <15.
PG_MAJOR="\$(sudo -u postgres psql -tAc 'SHOW server_version_num;' 2>/dev/null | cut -c1-2 || echo 0)"
if [ -n "\$PG_MAJOR" ] && [ "\$PG_MAJOR" -lt 15 ] 2>/dev/null; then
  die "Installed PostgreSQL is version \$PG_MAJOR (need 15+). See docs/INSTALL.md § PostgreSQL setup for the PGDG recipe for your distro."
fi
ok "PostgreSQL \$(sudo -u postgres psql -tAc 'SHOW server_version;' | xargs) ready."

# ─── 2. Node 22 from NodeSource ───────────────────────────────────────
# Use command -v FIRST — \`node -v 2>/dev/null | sed ...\` in a
# \$(...) substitution exits 127 when node is missing, and pipefail
# + set -e kills the script before we can handle it.
NODE_MAJOR=""
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="\$(node -v | sed 's/v//; s/\\..*//')"
fi
if [ "\$NODE_MAJOR" != "22" ]; then
  info "Installing Node 22 from NodeSource (current: \${NODE_MAJOR:-none})…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>&1 | tee -a "\$LOG" | tail -3
  apt-get install -y nodejs 2>&1 | tee -a "\$LOG" | tail -3
  ok "Node \$(node -v) installed."
else
  ok "Node 22 already present."
fi

# ─── 3. pnpm + pm2 ────────────────────────────────────────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  info "Installing pnpm…"
  npm install -g pnpm 2>&1 | tee -a "\$LOG" | tail -3
fi
if ! command -v pm2 >/dev/null 2>&1; then
  info "Installing pm2…"
  npm install -g pm2 2>&1 | tee -a "\$LOG" | tail -3
fi
ok "pnpm \$(pnpm -v) + pm2 \$(pm2 -v) ready."

# ─── 4. PostgreSQL DB + user with PG 15+ perms ────────────────────────
info "Configuring PostgreSQL role + database (idempotent, re-runnable)…"
# Drop + recreate user idempotently; pre-existing DB is KEPT (don't nuke
# the buyer's data on a re-run).
sudo -u postgres psql 2>&1 <<PSQL | tee -a "\$LOG" | tail -4
DO \\\$\\\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='pos') THEN
    EXECUTE format('CREATE ROLE pos LOGIN PASSWORD %L', '\$PG_PASSWORD');
  ELSE
    EXECUTE format('ALTER ROLE pos WITH LOGIN PASSWORD %L', '\$PG_PASSWORD');
  END IF;
END \\\$\\\$;
SELECT 'db-exists' FROM pg_database WHERE datname='pos_prod';
PSQL
# Create DB if missing (separate statement — CREATE DATABASE can't
# run inside a DO block).
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='pos_prod';" | grep -q 1 \\
  || sudo -u postgres psql -c "CREATE DATABASE pos_prod OWNER pos;" 2>&1 | tee -a "\$LOG" | tail -2
# PG 15+ revoked the default CREATE on public — explicit grant.
sudo -u postgres psql -d pos_prod -c "GRANT ALL ON SCHEMA public TO pos; ALTER SCHEMA public OWNER TO pos;" 2>&1 | tee -a "\$LOG" | tail -2
ok "Database pos_prod ready (user: pos)."

# ─── 5. .env ──────────────────────────────────────────────────────────
info "Writing .env…"
cat > "\$INSTALL_DIR/.env" <<EOF
NODE_ENV=production
PORT=3001
DATABASE_URL="postgresql://pos:\${PG_PASSWORD}@127.0.0.1:5432/pos_prod?schema=public"
JWT_SECRET="\${JWT1}"
JWT_REFRESH_SECRET="\${JWT2}"
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
CORS_ORIGINS=http://localhost
EOF
chmod 600 "\$INSTALL_DIR/.env"
ok ".env written (chmod 600)."

# ─── 6. install deps, migrate, seed ───────────────────────────────────
info "Installing Node dependencies (first run can take 2-5 minutes on slow networks)…"
cd "\$INSTALL_DIR"
# Full passthrough — silently filtering pnpm output hid a real
# install failure in an earlier revision. Verbose output AND a
# post-install existence check for the prisma CLI so "migrate"
# doesn't fail with a cryptic "node_modules missing".
pnpm install --prod 2>&1 | tee -a "\$LOG"
if [ ! -x "node_modules/.bin/prisma" ]; then
  die "pnpm install completed but node_modules/.bin/prisma is missing. See /var/log/restaurant-pos-install.log for details — common causes: network timeout (retry), disk full, pnpm store corrupted (pnpm store prune)."
fi
ok "Dependencies installed (\$(ls node_modules | wc -l) packages)."

info "Running database migrations…"
pnpm db:migrate 2>&1 | tee -a "\$LOG"
ok "Migrations applied."

info "Seeding initial SystemConfig row (wizard sentinel)…"
pnpm db:seed:empty 2>&1 | tee -a "\$LOG"
ok "Empty seed applied."

# ─── 7. nginx site config ─────────────────────────────────────────────
info "Writing nginx config…"
cat > /etc/nginx/sites-available/restaurant-pos <<NGINX
server {
    listen 80 default_server;
    server_name \${DOMAIN};
    client_max_body_size 25M;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \\\$host;
    }

    location = /admin { return 301 /admin/; }
    location = /pos   { return 301 /pos/; }
    location = /kds   { return 301 /kds/; }
    location = /qr    { return 301 /qr/; }

    location /admin/ { alias \${INSTALL_DIR}/admin/; try_files \\\$uri \\\$uri/ /admin/index.html; }
    location /pos/   { alias \${INSTALL_DIR}/pos/;   try_files \\\$uri \\\$uri/ /pos/index.html; }
    location /kds/   { alias \${INSTALL_DIR}/kds/;   try_files \\\$uri \\\$uri/ /kds/index.html; }
    location /qr/    { alias \${INSTALL_DIR}/qr-order/; try_files \\\$uri \\\$uri/ /qr/index.html; }
    location /       { root \${INSTALL_DIR}/web; try_files \\\$uri \\\$uri/ /index.html; }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/restaurant-pos /etc/nginx/sites-enabled/restaurant-pos
chmod -R o+rX "\$INSTALL_DIR"
nginx -t 2>&1 | tee -a "\$LOG" | tail -3
systemctl reload nginx 2>&1 | tee -a "\$LOG" | tail -2
ok "nginx configured."

# ─── 8. pm2 ───────────────────────────────────────────────────────────
info "Starting the API under PM2…"
pm2 delete pos-api 2>/dev/null || true
pm2 start api/dist/main.js --name pos-api --cwd "\$INSTALL_DIR" 2>&1 | tee -a "\$LOG" | tail -5
pm2 save 2>&1 | tee -a "\$LOG" | tail -2
pm2 startup systemd -u root --hp /root 2>&1 | tee -a "\$LOG" | tail -2 || true
ok "API running."

# ─── 9. health probe ──────────────────────────────────────────────────
sleep 4
# Both || true so a failing curl/grep doesn't kill the script under
# set -e + pipefail — the warn() path is how we tell the buyer it's
# not responding.
HEALTH="\$(curl -sS http://127.0.0.1/api/v1/health 2>/dev/null || true)"
if echo "\$HEALTH" | grep -q '"status":"ok"' 2>/dev/null; then
  ok "Health check passed."
else
  warn "Health endpoint didn't respond cleanly yet. Check \\\`pm2 logs pos-api\\\`."
fi

# ─── done ─────────────────────────────────────────────────────────────
IP="\$(hostname -I 2>/dev/null | awk '{print \\\$1}' || echo 'your-server-ip')"
cat <<EOF

────────────────────────────────────────────────
 INSTALL COMPLETE
────────────────────────────────────────────────
Admin:   http://\${IP}/admin/      (run the install wizard here)
POS:     http://\${IP}/pos/
KDS:     http://\${IP}/kds/
QR:      http://\${IP}/qr/
Website: http://\${IP}/
Health:  http://\${IP}/api/v1/health

Database: pos_prod
  User:   pos
  Pass:   \${PG_PASSWORD}
  (saved in .env — chmod 600)

Next steps:
  1. Point DNS \${DOMAIN} → \${IP} (if you set a real domain above).
  2. Add HTTPS:
       apt install -y certbot python3-certbot-nginx
       certbot --nginx -d \${DOMAIN}
  3. Visit http://\${IP}/admin/ and walk the wizard (license →
     branch → owner → brand → finish).

Troubleshooting: pm2 logs pos-api, or docs/INSTALL.md §Troubleshooting.
────────────────────────────────────────────────
EOF
`,
  );

  writeFileSync(
    join(STAGE, 'README.md'),
    `# Restaurant POS — Self-Hosted

Thanks for purchasing! This zip contains the full source + a Docker
Compose deploy template. Three install paths in
[docs/codecanyon-landing.html](docs/codecanyon-landing.html), full
runbook in [docs/INSTALL.md](docs/INSTALL.md).

## Quick start (Docker)

\`\`\`
cp .env.example .env
nano .env            # fill DATABASE_URL, JWT_SECRET, etc
docker compose up -d --build
\`\`\`

Then visit \`https://yourdomain.com/admin\` and run the install wizard.

## Layout

| Path | Purpose |
| ---- | ------- |
| \`api/\` | NestJS API build + package.json |
| \`admin/\`, \`pos/\`, \`kds/\`, \`qr-order/\`, \`web/\` | Built SPAs |
| \`prisma/\` | Schema + migrations + seed dispatcher |
| \`docs/\` | Install / domain / update guides + landing page |
| \`docker-compose.yml\`, \`Caddyfile\`, \`install.sh\` | Deploy templates |
| \`manifest.json\`, \`manifest.sig\` | Signed file inventory (used by the in-app updater) |

## License

See [LICENSE.txt](LICENSE.txt). CodeCanyon Regular or Extended terms.
`,
  );

  writeFileSync(
    join(STAGE, 'LICENSE.txt'),
    `Restaurant POS — Self-Hosted Edition
Copyright (c) 2026

Sold under the CodeCanyon (Envato Market) Regular or Extended License.
Full terms: https://codecanyon.net/licenses/standard

Summary (paraphrased; the link above is authoritative):

REGULAR LICENSE
- Use in ONE end product (one restaurant / one chain) for yourself or
  one client.
- The end product cannot itself be sold to multiple end users — i.e.
  no SaaS resale of this product as-is.
- Charge end users for access to your installed copy is allowed.
- May modify the source freely.

EXTENDED LICENSE
- Same as Regular, plus permits charging end users a fee for access
  to your end product (SaaS-style).
- Per-tenant license required if running multi-tenant.

NOT ALLOWED under either license:
- Re-distributing the source as-is or modified for free or for sale.
- Using project logo / branding for any product not based on this
  install.
`,
  );
});

let manifest;
step('compute manifest (sha256 + version + file list)', () => {
  const files = [];
  for (const f of walk(STAGE)) {
    const rel = relative(STAGE, f).split(sep).join('/');
    const buf = readFileSync(f);
    const sha = createHash('sha256').update(buf).digest('hex');
    files.push({ path: rel, sha256: sha, size: statSync(f).size });
  }
  manifest = {
    name: global.__NAME__,
    version: global.__VERSION__,
    builtAt: new Date().toISOString(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
  const out = JSON.stringify(manifest, null, 2);
  writeFileSync(join(STAGE, 'manifest.json'), out);
  console.log(`manifest: ${files.length} files, ${(Buffer.byteLength(out) / 1024).toFixed(1)} kB`);
});

if (!skip('sign')) {
  step('sign manifest', () => {
    if (!process.env.RELEASE_SIGNING_PRIVATE_KEY) {
      console.warn('  ⚠  RELEASE_SIGNING_PRIVATE_KEY not set — skipping signature');
      console.warn('     (the in-app updater will refuse to apply unsigned releases)');
      return;
    }
    sh(`node scripts/lib/sign-manifest.mjs "${join(STAGE, 'manifest.json')}" "${join(STAGE, 'manifest.sig')}"`);
  });
}

if (!skip('scan')) {
  step('secret-scan staged tree', () => {
    const r = spawnSync('node', [join(ROOT, 'scripts/lib/secret-scan.mjs'), STAGE], { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error('secret scanner found brand/secret leaks in the staged tree — aborting');
      process.exit(r.status ?? 1);
    }
  });
}

step('zip', () => {
  // Try the platform's available zipper in priority order. The point
  // is to work on a fresh CI runner AND a Windows dev box without
  // forcing either to install a new tool.
  //   1. `zip`      — Linux/macOS standard
  //   2. `7z`       — Common on Windows (7-Zip)
  //   3. PowerShell Compress-Archive — built into Windows 10+
  const releaseDir = join(ROOT, 'release');
  const tryZip = () => sh(`zip -rq "${ZIP}" "${RELEASE_NAME}/"`, { cwd: releaseDir });
  const try7z = () => sh(`7z a -tzip -bd "${ZIP}" "${RELEASE_NAME}/" -mx5`, { cwd: releaseDir });
  // Python's zipfile module writes POSIX forward-slash paths. Tried
  // PowerShell's Compress-Archive first — it produces Windows-style
  // backslash paths that Linux `unzip` drops silently. Don't do that.
  const tryPython = () => sh(`python -c "import zipfile, os, pathlib; src=pathlib.Path('${RELEASE_NAME}'); dst=pathlib.Path(r'${ZIP}'); dst.unlink(missing_ok=True); z=zipfile.ZipFile(dst,'w',zipfile.ZIP_DEFLATED,compresslevel=6); [z.write(p, arcname=p.as_posix()) for p in src.rglob('*') if p.is_file()]; z.close()"`, { cwd: releaseDir });

  const attempts = [['zip', tryZip], ['7z', try7z], ['python-zipfile', tryPython]];
  let ok = false;
  for (const [name, fn] of attempts) {
    try {
      fn();
      console.log(`(packed via ${name})`);
      ok = true;
      break;
    } catch {
      // keep trying
    }
  }
  if (!ok) {
    console.error('No zip tool available. Install one of: `zip` (apt install zip), `7z` (7-Zip on PATH), or run on Windows 10+ (PowerShell Compress-Archive is built in).');
    process.exit(1);
  }
  const sz = statSync(ZIP).size;
  console.log(`\n✔ ${ZIP}  (${(sz / (1024 * 1024)).toFixed(1)} MB)`);
});

// ── helpers ─────────────────────────────────────────────────────────

function* walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(abs);
    else if (ent.isFile()) yield abs;
  }
}
