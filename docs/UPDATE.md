# Updates

## Buyer path: re-upload zip via the admin UI

Default. Settings → Updates → drop the new release zip in the
uploader. The system:

1. Verifies the zip's `manifest.sig` against the bundled public key.
2. Stages the new files in `apps/api/updates/staging/`.
3. Backs the current install up via the existing backup service
   (the same one that runs nightly).
4. Runs `prisma migrate deploy` against the live DB.
5. Atomically swaps `current/` → `prev/` and `new/` → `current/`.
6. Restarts the API process.
7. Loops `/api/v1/health` 30× at 1s intervals. If any check fails,
   rolls back automatically (DB restore + reverse swap).

You stay on the page through the whole thing; a progress bar shows
each step. Total time on a small install: ~30s.

## SSH path

For developers who'd rather drive updates from the shell:

```bash
cd /opt/restaurant-pos
# Backup first
pnpm db:backup
# Replace files (preserving .env + uploads)
tar --exclude='./.env' --exclude='./api/uploads' -xzf restaurant-pos-v1.1.0.zip --strip-components=1
# Update + migrate
pnpm install --frozen-lockfile
pnpm prisma migrate deploy --schema prisma/schema.prisma
# Reload
pm2 reload pos-api
```

## What survives an update

| Survives | Lost |
| -------- | ---- |
| Database (orders, customers, menu, settings) | Source modifications you made in `api/dist`, `admin/`, etc — the buyer-zip overwrites those |
| `.env` (env vars are file-based, never re-uploaded) | Custom file uploads in `apps/api/uploads/` (preserved if you exclude that dir during extract) |
| Theme overrides in `apps/admin/src/styles/branding.css` | Patches to the SPA bundles — re-build from source if you have local mods |
| License activation | — |

If you have local source modifications, fork the repo and merge
upstream changes manually rather than using the zip-update flow.

## Rollback

Updates that fail health checks roll back automatically. To roll back
manually after the fact:

```bash
cd /opt/restaurant-pos
# Restore the pre-update DB snapshot
pnpm db:restore --file backups/<timestamp>.dump
# Swap back
mv current current.failed && mv prev current
pm2 reload pos-api
```

The `prev/` directory holds exactly one previous release — the zip
update sequence keeps it through the next update cycle for emergency
rollbacks.
