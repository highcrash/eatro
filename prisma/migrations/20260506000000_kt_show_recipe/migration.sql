-- Kitchen ticket recipe attachment. Two columns:
--   - branch_settings.kotShowRecipe: branch-wide toggle (default ON)
--   - menu_items.kotHideRecipe:      per-item override (default OFF, meaning "follow branch")
ALTER TABLE "branch_settings" ADD COLUMN "kotShowRecipe" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "menu_items"      ADD COLUMN "kotHideRecipe" BOOLEAN NOT NULL DEFAULT false;
