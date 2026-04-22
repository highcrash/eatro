-- Backfill itemCode for parents and sku for variants that have neither
-- a user-supplied code nor an auto one. Gives every active ingredient +
-- variant a stable lookup key for the Stock Update CSV.
--
-- gen_random_uuid() is available out of the box on PostgreSQL 13+.

UPDATE "ingredients"
SET "itemCode" = 'AUTO-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6))
WHERE "itemCode" IS NULL
  AND "parentId" IS NULL
  AND "deletedAt" IS NULL;

UPDATE "ingredients"
SET "sku" = 'AUTO-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 6))
WHERE "sku" IS NULL
  AND "parentId" IS NOT NULL
  AND "deletedAt" IS NULL;
