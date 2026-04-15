-- Extend cooking_stations so each kitchen section can have its own
-- full printer target (name, IP, port) and an admin-controlled sort
-- order. Desktop routes KOT items to the section's configured printer;
-- NULL printer fields mean "fall back to the default kitchen slot".
ALTER TABLE "cooking_stations"
  ADD COLUMN "printerPort" INTEGER,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
