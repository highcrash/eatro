#!/usr/bin/env bash
# Daily pg_dump of the license DB into ./backups/. 14-day retention.
# Install as a root cron job on the droplet:
#
#   (crontab -l 2>/dev/null; echo "15 3 * * * /opt/restora-license/infra/license-droplet/backup.sh >> /var/log/restora-license-backup.log 2>&1") | crontab -
#
# Restore (destructive!):
#   gunzip -c backups/license-2026-04-20.sql.gz | \
#     docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
#
# For off-droplet safety, add an rclone step at the bottom to push the
# latest dump to Spaces / B2 / Drive.

set -euo pipefail

cd "$(dirname "$0")"

# Source .env so we know the postgres user/db without duplicating config.
# shellcheck source=/dev/null
set -a; . ./.env; set +a

STAMP="$(date -u +%Y-%m-%d)"
OUT_DIR="./backups"
mkdir -p "$OUT_DIR"

OUT_FILE="$OUT_DIR/license-$STAMP.sql.gz"

docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists \
  | gzip > "$OUT_FILE"

# Prune dumps older than 14 days.
find "$OUT_DIR" -maxdepth 1 -type f -name 'license-*.sql.gz' -mtime +14 -delete

echo "backup ok: $OUT_FILE ($(stat -c %s "$OUT_FILE") bytes)"
