-- AlterTable: payment_method_configs — flag a category as a food-
-- delivery aggregator group. Drives the Aggregator P&L report's
-- auto-discovery (any option under a flagged category counts) and
-- the POS Takeaway card platform badge. Default false so existing
-- categories (CASH / CARD / MFS / DIGITAL) keep current behavior.
ALTER TABLE "payment_method_configs"
  ADD COLUMN "isAggregator" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: payment_options — optional brand colour (hex) for the
-- POS takeaway pill and the P&L report. Null = grey fallback.
ALTER TABLE "payment_options"
  ADD COLUMN "color" TEXT;
