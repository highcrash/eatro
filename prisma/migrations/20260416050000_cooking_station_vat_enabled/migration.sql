-- Per-section VAT opt-out on cooking stations. Default true keeps all
-- existing sections taxable; admin can toggle off to zero-rate a
-- section's items on new orders.
ALTER TABLE "cooking_stations"
  ADD COLUMN IF NOT EXISTS "vatEnabled" BOOLEAN NOT NULL DEFAULT true;
