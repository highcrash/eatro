-- AlterTable: loyalty_transactions — persist the per-redemption taka
-- discount so adding / removing items doesn't lose the loyalty discount
-- portion on recompute. Default 0 = legacy EARNED / EXPIRED /
-- ADJUSTMENT rows stay correct; new REDEEMED rows snapshot the paisa
-- amount at redemption time (rate-change-proof).
ALTER TABLE "loyalty_transactions"
  ADD COLUMN "discountAmount" DECIMAL(14, 2) NOT NULL DEFAULT 0;
