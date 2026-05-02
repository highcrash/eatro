-- Generic admin-config audit trail. Records who/what/when for every
-- admin-side mutation (menu, recipes, ingredients, suppliers, expenses,
-- accounts, settings, etc.). Order / payment audit lives in their own
-- purpose-built fields and is NOT duplicated here.
--
-- Retention is 90 days, enforced nightly by ActivityLogScheduler. Indexes
-- target the three read patterns: global feed (branchId, createdAt),
-- per-category filter (branchId, category, createdAt), per-entity
-- drill-in (entityType, entityId, createdAt).
--
-- Pure additive — no existing tables are touched.

CREATE TYPE "ActivityCategory" AS ENUM (
  'MENU',
  'RECIPE',
  'INGREDIENT',
  'SUPPLIER',
  'PURCHASING',
  'EXPENSE',
  'ACCOUNT',
  'PAYROLL',
  'CUSTOMER',
  'STAFF',
  'BRANCH',
  'DISCOUNT',
  'RESERVATION',
  'WASTE',
  'PRE_READY',
  'SETTINGS',
  'PERMISSIONS',
  'COOKING_STATION',
  'TABLE'
);

CREATE TYPE "ActivityAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

CREATE TABLE "activity_logs" (
  "id"          TEXT             NOT NULL,
  "branchId"    TEXT             NOT NULL,
  "actorId"     TEXT,
  "actorName"   TEXT,
  "actorRole"   TEXT,
  "category"    "ActivityCategory" NOT NULL,
  "action"      "ActivityAction"   NOT NULL,
  "entityType"  TEXT             NOT NULL,
  "entityId"    TEXT             NOT NULL,
  "entityName"  TEXT             NOT NULL,
  "diff"        JSONB,
  "summary"     TEXT,
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "activity_logs_branchId_createdAt_idx"
  ON "activity_logs" ("branchId", "createdAt");

CREATE INDEX "activity_logs_branchId_category_createdAt_idx"
  ON "activity_logs" ("branchId", "category", "createdAt");

CREATE INDEX "activity_logs_entityType_entityId_createdAt_idx"
  ON "activity_logs" ("entityType", "entityId", "createdAt");

ALTER TABLE "activity_logs"
  ADD CONSTRAINT "activity_logs_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Staff actor is nullable + SetNull on delete so a future staff
-- offboarding doesn't cascade-wipe their audit history.
ALTER TABLE "activity_logs"
  ADD CONSTRAINT "activity_logs_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
