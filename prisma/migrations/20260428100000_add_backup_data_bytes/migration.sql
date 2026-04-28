-- Store the gzipped backup payload directly in Postgres so /backup/:id/download
-- survives container restarts on ephemeral-disk hosts (DigitalOcean App
-- Platform). Disk copy is still written best-effort for local dev convenience
-- but the DB column is the source of truth.
--
-- Pure additive: nullable column. Pre-existing rows keep working in the list,
-- but their download will 404 (their disk file was already gone after the
-- redeploy that surfaced the bug — the DB row was the orphan).

ALTER TABLE "backup_records" ADD COLUMN "data" BYTEA;
ALTER TABLE "backup_records" ADD COLUMN "spacesKey" TEXT;
