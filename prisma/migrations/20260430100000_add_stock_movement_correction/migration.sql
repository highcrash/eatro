-- Stock-movement correction audit columns. Admin can edit a SALE
-- (or any) movement's quantity post-hoc when a recipe typo deducted
-- the wrong amount (e.g. "10 KG" instead of "10 G"). The original
-- value is preserved in correctedFromQuantity for audit; quantity
-- holds the new value so reports stay accurate.
--
-- Pure additive: three nullable columns. Pre-existing movements
-- have all three NULL, behave identically to before.

ALTER TABLE "stock_movements"
  ADD COLUMN "correctedAt" TIMESTAMP(3),
  ADD COLUMN "correctedFromQuantity" DECIMAL(14,4),
  ADD COLUMN "correctionReason" TEXT;
