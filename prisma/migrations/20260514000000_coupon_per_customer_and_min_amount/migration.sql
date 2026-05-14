-- AlterTable: coupons — two new optional validation rules.
--   1. oncePerCustomer: when true, the same customer can only redeem
--      this code once across all of their orders (independent of the
--      global maxUses cap).
--   2. minOrderAmount: paisa threshold the order's pre-discount
--      subtotal must meet for the coupon to apply.
-- Both default to "no rule" so existing coupons keep current behavior.
ALTER TABLE "coupons"
  ADD COLUMN "oncePerCustomer" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "coupons"
  ADD COLUMN "minOrderAmount" DECIMAL(14, 2);
