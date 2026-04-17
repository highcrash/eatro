-- QR-ordering network gate: owner can restrict QR checkout to clients
-- whose IP matches an allowlist (typically the restaurant's LAN/CIDR),
-- with an in-app fallback page that shows Wi-Fi SSID + password so
-- guests can join the right network. Columns added idempotently so
-- re-running the migration on a partially-applied DB is safe.
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "wifiSsid"      TEXT,
  ADD COLUMN IF NOT EXISTS "qrGateEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "qrAllowedIps"  TEXT,
  ADD COLUMN IF NOT EXISTS "qrGateMessage" TEXT;
