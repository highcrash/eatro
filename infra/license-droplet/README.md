# License droplet — deployment runbook

Single-VPS deployment of the license stack at `neawaslic.top`. Suits a
CodeCanyon item where verify traffic is low and a $6-$12 droplet
comfortably runs Postgres + Nest + Caddy + an nginx-served SPA.

## What lives where

| Container      | Image                                 | Purpose                                  |
| -------------- | ------------------------------------- | ---------------------------------------- |
| caddy          | `caddy:2-alpine`                      | Public entry on :80/:443, ACME TLS       |
| license-server | built from `apps/license-server/`     | NestJS license API on :3002              |
| license-admin  | built from `apps/license-admin/`      | Vite SPA served by nginx on :80          |
| postgres       | `postgres:15-alpine`                  | Isolated on the docker network           |

Only Caddy is reachable from the internet. Postgres has no published
port — it's only visible to the other containers on the docker network.

## First-time provisioning

Pick the smallest DO droplet that isn't the $4 shared (the license
stack idles fine on $6, has headroom on $12). Ubuntu 22.04 or 24.04.

```bash
# From your workstation:
ssh root@<droplet-ip>

# On the droplet — clone + install prerequisites + firewall:
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/infra/license-droplet/provision.sh \
  | bash -s -- https://github.com/<you>/<repo>.git main
```

`provision.sh` is idempotent — safe to re-run. It installs Docker
Engine + compose plugin, opens ports 22/80/443, clones the repo to
`/opt/restora-license`, and seeds `infra/license-droplet/.env` from
`.env.example`.

## DNS — do this BEFORE `docker compose up`

Point all three hostnames at the droplet's public IP:

```
api.neawaslic.top    A  <droplet-ip>
admin.neawaslic.top  A  <droplet-ip>
neawaslic.top        A  <droplet-ip>
```

Caddy issues Let's Encrypt certs via the ACME HTTP-01 challenge on the
first hit — if DNS isn't pointing at the droplet yet, validation fails
and Let's Encrypt rate-limits further attempts. Wait for propagation
(usually < 5 min with Cloudflare / most registrars) before starting.

## Secrets

Fill `/opt/restora-license/infra/license-droplet/.env`. The file has
inline generation commands for each secret. The critical ones:

- `LICENSE_SIGNING_KEK` — 32B base64. Wraps every ed25519 private
  signing key in the DB. **Set once, never rotate** without a planned
  migration that re-wraps every key.
- `LICENSE_HMAC_PEPPER` — 32B base64. Mixed into HKDF when deriving
  per-license hmacSecrets. Same rotation constraint.
- `POSTGRES_PASSWORD` — strong random. Even though Postgres isn't
  published, defence-in-depth matters if the droplet is compromised.
- `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` — seeded into `admin_users`
  only on empty DB. Change the password from the admin UI after first
  login; the env values are ignored afterwards.

`chmod 600 .env` so other users on the droplet (if any) can't read it.

## Start the stack

```bash
cd /opt/restora-license/infra/license-droplet
docker compose up -d --build
```

Watch the first boot:

```bash
docker compose logs -f caddy           # cert issuance
docker compose logs -f license-server  # migrations + Nest bootstrap
```

When `https://admin.neawaslic.top` loads the login page and
`https://api.neawaslic.top/api/v1/health` returns `{"status":"ok"}`,
you're live.

## Updates

```bash
cd /opt/restora-license
git pull
cd infra/license-droplet
docker compose up -d --build
```

The `build` flag forces a rebuild when source changed; compose reuses
the previous image otherwise. Database migrations run on container
start inside `license-server` (it invokes `prisma migrate deploy` before
`node dist/main.js`), so schema changes ship transparently.

## Backups

`backup.sh` does a compressed `pg_dump` with 14-day retention. Install
as a root cron:

```bash
(crontab -l 2>/dev/null; echo "15 3 * * * /opt/restora-license/infra/license-droplet/backup.sh >> /var/log/restora-license-backup.log 2>&1") | crontab -
```

For off-droplet safety, append an `rclone copy` / `aws s3 cp` step to
`backup.sh` that pushes the latest dump to Spaces / B2 / Drive. If the
droplet's disk is the only copy, a hardware failure loses everything.

## Restore

```bash
cd /opt/restora-license/infra/license-droplet
gunzip -c backups/license-YYYY-MM-DD.sql.gz \
  | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

Note: `pg_dump --clean --if-exists` drops existing objects before
re-creating, so restoring over a live DB nukes current state. Take a
fresh dump first if you're only recovering a single table.

## Troubleshooting

**Cert stuck on "obtaining"** — check `docker compose logs caddy`. Most
common cause is DNS not propagated yet, or AAAA records pointing
somewhere else. Let's Encrypt prefers IPv6 if present.

**license-server restarting** — `docker compose logs license-server`.
Usually one of: (a) `LICENSE_DB_URL` wrong (hostname should be
`postgres`, not `localhost`), (b) `LICENSE_SIGNING_KEK` or
`LICENSE_HMAC_PEPPER` not exactly 32 bytes after base64 decode, (c)
migrations failing against an incompatible DB state.

**`docker compose up` OOMs on the build** — a $6 droplet has 1 GB RAM
and pnpm + nest can spike close to it. Add a 1 GB swap file:

```bash
fallocate -l 1G /swapfile && chmod 600 /swapfile \
  && mkswap /swapfile && swapon /swapfile \
  && echo '/swapfile none swap sw 0 0' >> /etc/fstab
```
