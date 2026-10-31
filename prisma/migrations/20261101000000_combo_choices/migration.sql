-- Combos that actually work end to end:
--   * combo_items.choiceGroup / sortOrder — rows sharing a choiceGroup on
--     one combo are alternatives for a single slot (e.g. "Fizz" ×4 split
--     across Coke / Sprite / Fanta); the lowest sortOrder is the default.
--   * order_items.comboItems — per-unit snapshot of what one combo
--     contained when ordered, so stock, KT and voids use the guest's
--     actual picks even if the combo is edited later.
--
-- Additive; existing rows keep working (null choiceGroup = fixed part).
ALTER TABLE "combo_items" ADD COLUMN "choiceGroup" TEXT;
ALTER TABLE "combo_items" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "comboItems" JSONB;
