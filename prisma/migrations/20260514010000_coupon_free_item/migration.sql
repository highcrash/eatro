-- New coupon benefit type: FREE_ITEM. Instead of taking ৳ off the
-- bill, the coupon auto-adds a designated menu item to the order at
-- ৳0. Discount model rejects this type at the service layer — it's
-- coupon-only.
ALTER TYPE "DiscountType" ADD VALUE IF NOT EXISTS 'FREE_ITEM';

-- Coupon: pointer to the menu item to give away free. Required when
-- type === FREE_ITEM (enforced at the service layer, not the DB —
-- the column is nullable so existing FLAT/PERCENTAGE rows don't need
-- a backfill).
ALTER TABLE "coupons"
  ADD COLUMN "freeMenuItemId" TEXT;

CREATE INDEX "coupons_freeMenuItemId_idx" ON "coupons"("freeMenuItemId");

-- SetNull on delete so deleting a menu item doesn't cascade-kill
-- coupons. The coupon will fail at next apply with a clear error and
-- the admin can fix it (point at a different item or deactivate).
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_freeMenuItemId_fkey"
  FOREIGN KEY ("freeMenuItemId") REFERENCES "menu_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- OrderItem: marker for "this line was auto-added by a FREE_ITEM
-- coupon". removeDiscount uses it to void exactly the freebies the
-- coupon added when the cashier/customer detaches it.
ALTER TABLE "order_items"
  ADD COLUMN "fromCouponId" TEXT;

CREATE INDEX "order_items_fromCouponId_idx" ON "order_items"("fromCouponId");

-- SetNull on coupon delete so historical orders aren't orphaned —
-- the line stays on the order, just loses its coupon back-reference.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_fromCouponId_fkey"
  FOREIGN KEY ("fromCouponId") REFERENCES "coupons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
