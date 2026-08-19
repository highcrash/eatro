-- Track when POS successfully prints the bill/check for an order, so
-- moving items off the order afterward can be gated behind manager
-- approval (moveItemAfterBillPrint cashier-permission).
--
-- Additive and nullable — existing rows are safe.
ALTER TABLE "orders" ADD COLUMN "billPrintedAt" TIMESTAMP(3);
