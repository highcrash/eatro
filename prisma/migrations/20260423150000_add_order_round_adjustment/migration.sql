-- Order.roundAdjustment: paisa delta the auto-round-to-taka pass added
-- to (or subtracted from) totalAmount. Signed. Zero on historical orders.
ALTER TABLE "orders"
  ADD COLUMN "roundAdjustment" DECIMAL(14, 2) NOT NULL DEFAULT 0;
