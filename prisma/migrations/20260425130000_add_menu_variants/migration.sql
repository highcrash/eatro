-- Variants — one level deep. A "parent shell" MenuItem groups several
-- sellable variants (e.g. "Hargao" → "Prawn ৳450", "Chicken ৳350").
-- Each variant carries its own price + recipe like any other MenuItem,
-- so reports / stock deduction / KT print all keep working unchanged.
-- Defaults are NULL / false so existing rows behave identically until
-- admin opts in by toggling Has Variants on a menu item.

ALTER TABLE "menu_items"
  ADD COLUMN "variantParentId" TEXT,
  ADD COLUMN "isVariantParent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_variantParentId_fkey"
  FOREIGN KEY ("variantParentId") REFERENCES "menu_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "menu_items_variantParentId_idx" ON "menu_items"("variantParentId");
