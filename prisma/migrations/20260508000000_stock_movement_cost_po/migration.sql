-- Stock Watcher prerequisites: persist per-movement unit cost and
-- direct FK to the PurchaseOrder for PURCHASE rows. Both nullable
-- so the migration is non-breaking — every existing row stays
-- intact; the new columns are populated only by movements created
-- after this migration runs.

-- 1. unitCostPaisa — per-unit cost in paisa AT TIME OF MOVEMENT.
ALTER TABLE "stock_movements"
  ADD COLUMN "unitCostPaisa" DECIMAL(14, 4);

-- 2. purchaseOrderId — direct FK so PURCHASE rows can join to the
--    PO + Supplier without parsing the legacy "PO <8-char-id>" notes.
ALTER TABLE "stock_movements"
  ADD COLUMN "purchaseOrderId" TEXT;

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Range-scan index for the Stock Watcher report. The existing
--    @@index([ingredientId]) is too coarse — we always filter by
--    (ingredientId, createdAt range), so the composite index hits
--    the partition the planner needs and avoids a full per-ingredient
--    table scan.
CREATE INDEX "stock_movements_ingredientId_createdAt_idx"
  ON "stock_movements" ("ingredientId", "createdAt");

-- The legacy single-column @@index([ingredientId]) is now redundant
-- (the composite index covers single-column lookups too). Drop it
-- to keep the index footprint tight.
DROP INDEX IF EXISTS "stock_movements_ingredientId_idx";
