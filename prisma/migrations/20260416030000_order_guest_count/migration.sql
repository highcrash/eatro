-- Guest count per order — printed on bill and payment receipts so audit
-- trails record how many people were at each table. Defaults to 0; any
-- existing orders stay at 0 which matches the legacy "not captured" state.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "guestCount" INTEGER NOT NULL DEFAULT 0;
