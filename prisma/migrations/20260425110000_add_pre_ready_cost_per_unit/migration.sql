-- Pre-ready items now carry an auto-calculated cost per produced unit,
-- derived from the recipe (sum of ingredient cost × deduct qty / yield).
-- Refreshed by the Recalculate Cost button or on production complete.
-- Stored in paisa, default 0 so existing rows are unaffected.

ALTER TABLE "pre_ready_items"
  ADD COLUMN "costPerUnit" DECIMAL(14, 2) NOT NULL DEFAULT 0;
