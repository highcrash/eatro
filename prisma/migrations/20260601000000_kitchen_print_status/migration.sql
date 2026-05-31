-- Track outcome of Kitchen Ticket print attempts so the POS Reprint
-- KT button can show context (last printed at, success/failure,
-- error message) and the cashier can tell whether they're recovering
-- from a real failure or risking a duplicate.
--
-- All four columns are additive and nullable / defaulted, so existing
-- rows are safe.
ALTER TABLE "orders" ADD COLUMN "lastKitchenPrintAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "lastKitchenPrintStatus" TEXT;
ALTER TABLE "orders" ADD COLUMN "lastKitchenPrintError" TEXT;
ALTER TABLE "orders" ADD COLUMN "kitchenReprintCount" INTEGER NOT NULL DEFAULT 0;
