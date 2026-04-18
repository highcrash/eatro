#!/usr/bin/env bash
# One-shot provisioner for a fresh Ubuntu 22.04 / 24.04 DO droplet.
# Idempotent — safe to re-run. Installs Docker, clones the repo (or
# pulls latest if it's already there), opens the firewall, leaves you
# ready to `docker compose up -d`.
#
# Usage on the droplet (as root or with sudo):
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/infra/license-droplet/provision.sh | bash -s -- <repo-url> <branch>
# Or copy this file over first and run `bash provision.sh <repo> <branch>`.
#
# After this finishes, see infra/license-droplet/README.md for the
# .env + first-boot steps.

set -euo pipefail

REPO_URL="${1:-}"
BRANCH="${2:-main}"
TARGET_DIR="/opt/restora-license"

if [[ -z "$REPO_URL" ]]; then
  echo "Usage: provision.sh <repo-url> [branch]" >&2
  exit 2
fi

log() { echo "[provision] $*"; }

# ─── Packages ───────────────────────────────────────────────────────
log "installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git gnupg ufw

# ─── Docker + compose plugin ────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  log "Docker already installed — skipping"
fi

# ─── Firewall ───────────────────────────────────────────────────────
# Allow SSH + HTTP + HTTPS. Postgres stays inside the docker network.
log "configuring ufw (22, 80, 443)"
ufw allow OpenSSH >/dev/null || true
ufw allow 80/tcp   >/dev/null || true
ufw allow 443/tcp  >/dev/null || true
ufw --force enable >/dev/null

# ─── Checkout ───────────────────────────────────────────────────────
if [[ ! -d "$TARGET_DIR/.git" ]]; then
  log "cloning $REPO_URL#$BRANCH -> $TARGET_DIR"
  mkdir -p "$TARGET_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
else
  log "repo exists — pulling latest on $BRANCH"
  git -C "$TARGET_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$TARGET_DIR" checkout "$BRANCH"
  git -C "$TARGET_DIR" reset --hard "origin/$BRANCH"
fi

# ─── .env scaffold ──────────────────────────────────────────────────
DROPLET_DIR="$TARGET_DIR/infra/license-droplet"
if [[ ! -f "$DROPLET_DIR/.env" ]]; then
  log "seeding .env from .env.example — EDIT IT BEFORE STARTING"
  cp "$DROPLET_DIR/.env.example" "$DROPLET_DIR/.env"
  chmod 600 "$DROPLET_DIR/.env"
else
  log ".env already present — leaving alone"
fi

cat <<EOF

─── next steps ──────────────────────────────────────────────────────
1. Point DNS before starting so Caddy can issue TLS certs:
     api.neawaslic.top     A  <this droplet's public IP>
     admin.neawaslic.top   A  <this droplet's public IP>
     neawaslic.top         A  <this droplet's public IP>

2. Fill secrets in $DROPLET_DIR/.env (LICENSE_SIGNING_KEK,
   LICENSE_HMAC_PEPPER, POSTGRES_PASSWORD, JWT, admin seed).

3. Start the stack:
     cd $DROPLET_DIR
     docker compose up -d --build

4. Watch the logs for a clean boot + cert issuance:
     docker compose logs -f caddy
     docker compose logs -f license-server

5. Change the admin password in the UI (https://admin.neawaslic.top)
   — the env-seeded one is discarded after first login.

Pull updates later with:
     cd $TARGET_DIR && git pull && cd $DROPLET_DIR && docker compose up -d --build
─────────────────────────────────────────────────────────────────────
EOF
