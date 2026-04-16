-- Admin-controlled width of the bill logo on thermal receipts.
-- 0–100 (% of the 80mm paper). Default 80 matches a reasonable "fills
-- the banner without edge-bleed" value for most thermal printers.
ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "billLogoWidthPct" INTEGER NOT NULL DEFAULT 80;
