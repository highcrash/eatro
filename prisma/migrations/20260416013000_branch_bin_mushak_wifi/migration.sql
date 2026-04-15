-- Branding fields used by thermal receipts: Bangladesh BIN, Mushak / tax
-- software version, and guest Wi-Fi password. All optional; older branches
-- continue to work with NULL.
--
-- Note the table name is "branches" (@@map in schema.prisma), NOT "Branch".
-- IF NOT EXISTS on each column keeps this safe to re-run on an environment
-- where a partial attempt left the column behind.
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "bin" TEXT,
  ADD COLUMN IF NOT EXISTS "mushakVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "wifiPass" TEXT;
