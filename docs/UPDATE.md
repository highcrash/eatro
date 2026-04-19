# Updates

Two paths for getting a newer release onto your install. The admin-UI
path is the default one — every release zip since v1.0.0 is self-applying.
The SSH path is for developers and for cases where the UI is unreachable
(expired license, locked-out owner account).

## Buyer path: upload the zip via the admin UI

**Who can do this:** OWNER role only.

1. Sign in to your admin dashboard.
2. Sidebar → **Updates**. The page shows your current version, a
   release zip uploader, and history of past updates.
3. Drop the new zip (`your-restaurant-pos-v1.x.y.zip`) onto the
   dropzone. Click **UPLOAD + VERIFY**.
   - The server saves the zip, extracts it, and checks its
     `manifest.sig` against a public key bundled into your current
     install. A tampered or wrong-product zip is rejected with an
     inline error and the row is recorded as `FAILED` in History.
4. If verification passes, a green **STAGED — READY TO APPLY** card
   appears. Review the target version + release notes.
5. Click **APPLY NOW**. A confirmation dialog warns about the
   ~15-second restart. Approve it.
6. The server then:
   - Creates a manual DB backup (same mechanism as Settings → Backups,
     gzipped JSON dump kept under `backups/`)
   - Atomically renames the app directories (`api/`, `admin/`, `pos/`,
     `kds/`, `qr-order/`, `web/`, `prisma/`, `packages/`) from the
     current install aside into `updates/prev/`, and moves the new
     versions into place
   - Writes an apply-on-boot marker and exits cleanly
   - PM2 (or your Docker/systemd manager) auto-restarts the API into
     the new `api/dist/`
   - On boot, the new process sees the marker and flips the row from
     `APPLYING` → `APPLIED`
7. The admin page polls the history endpoint every 4s while a row is
   `APPLYING`; as soon as the new process is up and finalizes the
   marker, the banner clears and the history table shows `APPLIED`.

**Total downtime on a typical VPS install:** ~10-15 seconds.

### Rollback

The most recent pre-apply state is kept in `updates/prev/`. While the
current version's history row shows `APPLIED` (and no newer apply has
overwritten the prev tree), a **Rollback to <old-version>** button
appears on the CURRENT VERSION card. Clicking it:

- Restores the DB from the pre-apply backup
- Moves `updates/prev/` back into place
- Exits so PM2 restarts into the old dist

Rollback is one-deep — after you roll back, the rolled-back-from tree
is gone. Re-apply the newer zip through the same UI if you want to try
it again after diagnosing.

## SSH path (developers / recovery)

Use this if the admin UI is unreachable or you want to drive the update
from the shell:

```bash
cd /opt/restaurant-pos

# 1. Backup DB first (mandatory safety net)
pnpm --filter @restora/api exec node -e \
  "require('./dist/backup/backup.cli').runBackup()" \
  || pg_dump "$DATABASE_URL" | gzip > backups/pre-update-$(date +%Y%m%d-%H%M).sql.gz

# 2. Extract the new zip aside, preserving your .env + uploads
mkdir -p /tmp/pos-new
unzip -q restaurant-pos-v1.x.y.zip -d /tmp/pos-new
cp -a /tmp/pos-new/*/. /opt/restaurant-pos-new/

# 3. Preserve local state
cp /opt/restaurant-pos/.env /opt/restaurant-pos-new/.env
cp -a /opt/restaurant-pos/api/uploads /opt/restaurant-pos-new/api/uploads 2>/dev/null || true

# 4. Install deps + migrate
cd /opt/restaurant-pos-new
pnpm install --prod --frozen-lockfile
pnpm prisma migrate deploy --schema prisma/schema.prisma

# 5. Atomic swap
sudo systemctl stop restaurant-pos    # or: pm2 stop pos-api
sudo mv /opt/restaurant-pos /opt/restaurant-pos.prev
sudo mv /opt/restaurant-pos-new /opt/restaurant-pos
sudo systemctl start restaurant-pos   # or: pm2 start pos-api

# 6. Verify
curl -s http://127.0.0.1:3001/api/v1/health | head
```

## Database migrations

**v1.0.x behavior:** the in-app updater swaps files + restarts. It does
NOT run `prisma migrate deploy` automatically. If a release includes a
database migration (the release notes will say so explicitly), you
must SSH in and run it between apply and first-real-use:

```bash
cd /opt/restaurant-pos
pnpm prisma migrate deploy --schema prisma/schema.prisma
pm2 reload pos-api
```

Most patch releases (bug fixes, UI tweaks) ship without migrations.
The History page shows the migration file list as part of the
`manifest.json` in each staged release.

## What survives an update

| Survives | Lost |
| -------- | ---- |
| Database — orders, customers, menu, settings, license activation | Source modifications inside `api/dist/`, `admin/dist/`, etc — overwritten by the new zip |
| `.env` — never read from the uploaded zip | Custom files you manually added to shipped directories |
| `backups/` — backup files carry across updates | Out-of-band node_modules patches — `pnpm install` refreshes them |
| `api/uploads/` — never overwritten by an update | Theme overrides in forks — re-merge after updating |

If you run a forked copy with source patches, use the SSH path so you
can re-build the SPA from your fork before the swap.

## Troubleshooting

### "Verification failed: signature mismatch"

You uploaded a zip not signed with the same key the current install
trusts. Either it was tampered with, or you have the wrong product's
zip. Check you downloaded from the original sale receipt; re-download
if unsure.

### "Verification failed: missing manifest.json"

The zip wasn't produced by `scripts/package-codecanyon.mjs`. If you
built it yourself, re-run the packager — it's what generates the
manifest + signs it.

### History row stuck on APPLYING

The server exited but PM2 didn't restart it. Check:

```bash
pm2 list                        # api should be "online"
pm2 logs pos-api --lines 50
```

If PM2 is missing, your install manager is something else — restart
via its means (`systemctl restart restaurant-pos`, `docker compose
restart api`).

### Rollback button doesn't appear

It's only shown while the CURRENT VERSION card is visible, i.e.
there's no `STAGED` row pending and no `APPLYING` row in progress.
If you already applied a newer update on top, the older `prev/` tree
has been replaced and that specific rollback is no longer possible.

### Update failed mid-swap — the install looks broken

Recover via SSH:

```bash
cd /opt/restaurant-pos/updates/prev
ls                              # should show api/ admin/ ...
# Move everything back
cd /opt/restaurant-pos
for dir in api admin pos kds qr-order web prisma packages; do
  [ -d "$dir" ] && mv "$dir" "${dir}.broken"
  [ -d "updates/prev/$dir" ] && mv "updates/prev/$dir" "./$dir"
done
pm2 restart pos-api
```

Then open a ticket with the contents of `updates/archive/<last-id>.zip`
and the PM2 logs so we can diagnose.
