-- PurchaseOrder receipt-level adjustments captured at delivery time:
-- supplier-offered discount (flat amount) + extra fees (delivery, labour,
-- packaging, etc.). All amounts in paisa. Defaults are zero / null so
-- existing PO rows are unaffected.

ALTER TABLE "purchase_orders"
  ADD COLUMN "receiptDiscount"       DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "receiptDiscountReason" TEXT,
  ADD COLUMN "receiptExtraFees"      JSONB;
