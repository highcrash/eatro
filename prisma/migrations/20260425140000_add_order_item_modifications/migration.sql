-- Per-order line modifications (Phase 2 of variants/mods/addons).
-- Shape: { removedIngredientIds: string[], removedNames: string[] }.
-- Stock-deduction reads this and skips removed ingredient IDs; KT
-- printing prepends "— NO <NAME>" rows so the kitchen sees the diff.
-- Nullable; existing OrderItem rows stay null and behave identically.

ALTER TABLE "order_items"
  ADD COLUMN "modifications" JSONB;
