-- Link a PreReadyItem to the Ingredient row that menu recipes deduct
-- from, so a single source of truth replaces the two-counter drift
-- that previously plagued admins juggling [PR] inventory rows.
--
-- producesIngredientId: when set, every completed production batch
-- ALSO bumps the linked Ingredient.currentStock by the produced
-- yield. autoDeductInputs lets the admin opt out of the input-side
-- recipe deduction (some kitchens reconcile raw stock weekly by
-- hand). New StockMovementType PRODUCTION_RECEIVED tags the
-- produced-output rows so the Stock Movements feed reads
-- "Production: PG Katsu Mayo Sauce — Batch #42 (1000 G)".
--
-- Pure additive — existing rows keep their behaviour
-- (producesIngredientId is null → today's path).

ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'PRODUCTION_RECEIVED';

ALTER TABLE "pre_ready_items"
  ADD COLUMN "producesIngredientId" TEXT,
  ADD COLUMN "autoDeductInputs"     BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "pre_ready_items_producesIngredientId_idx"
  ON "pre_ready_items" ("producesIngredientId");

ALTER TABLE "pre_ready_items"
  ADD CONSTRAINT "pre_ready_items_producesIngredientId_fkey"
  FOREIGN KEY ("producesIngredientId") REFERENCES "ingredients"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
