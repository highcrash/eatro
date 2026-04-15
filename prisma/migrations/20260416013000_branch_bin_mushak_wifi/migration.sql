-- Branding fields used by thermal receipts: Bangladesh BIN, Mushak / tax
-- software version, and guest Wi-Fi password. All optional; older branches
-- continue to work with NULL.
ALTER TABLE "Branch"
  ADD COLUMN "bin" TEXT,
  ADD COLUMN "mushakVersion" TEXT,
  ADD COLUMN "wifiPass" TEXT;
