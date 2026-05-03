-- Auto-calculate ingredient minimumStock from recent consumption.
--
-- Two new columns; pure additive; no FK changes; no row touched.
--
-- branch_settings.autoMinStockDays = 0 means the feature is OFF for
-- the branch (today's behaviour — admin types minimums by hand).
-- A positive value tells the nightly cron + the manual "Recompute
-- Min Stock" button to rewrite each ingredient's minimumStock to the
-- total quantity consumed (SALE + OPERATIONAL_USE movements) over
-- the last N days.
--
-- ingredients.autoMinStock = true (default) opts the row into the
-- auto-rewrite. Setting it false on an individual ingredient lets
-- admin keep a hand-set minimum on items they care about (seasonal,
-- slow-movers, safety stock) without disabling the feature globally.

ALTER TABLE "branch_settings"
  ADD COLUMN "autoMinStockDays" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ingredients"
  ADD COLUMN "autoMinStock" BOOLEAN NOT NULL DEFAULT true;
