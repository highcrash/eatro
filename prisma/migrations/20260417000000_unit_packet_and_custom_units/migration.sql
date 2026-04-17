-- Extend StockUnit enum with common restaurant/retail packaging units.
-- PostgreSQL's ALTER TYPE ... ADD VALUE cannot run inside a transaction;
-- Prisma migrate executes each statement individually which is fine here.
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'PACKET';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'PACK';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'BOTTLE';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'BAG';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'BUNDLE';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'CAN';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'JAR';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'TIN';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'CARTON';

-- custom_units lets admin add new unit names at runtime. A row here is
-- paired with an ALTER TYPE ... ADD VALUE at creation time so the enum
-- actually accepts the new value. Soft-delete (via deletedAt) hides the
-- entry from dropdowns but leaves the enum value in place because
-- removing enum values isn't supported in Postgres without a full type
-- rebuild.
CREATE TABLE IF NOT EXISTS "custom_units" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "custom_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_units_branchId_code_key"
  ON "custom_units"("branchId", "code");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_units_branchId_fkey'
  ) THEN
    ALTER TABLE "custom_units" ADD CONSTRAINT "custom_units_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;
