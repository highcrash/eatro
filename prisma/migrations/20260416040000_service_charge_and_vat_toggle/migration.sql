-- Service charge (admin-controlled %) and a master VAT toggle. Also
-- tracks the computed service charge per order so reports and receipts
-- can break it out independently of VAT. All optional / default-safe
-- for existing branches and orders.
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "vatEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "serviceChargeEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "serviceChargeRate" DECIMAL(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "serviceChargeAmount" DECIMAL(14, 2) NOT NULL DEFAULT 0;
