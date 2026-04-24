-- Custom Roles — admin-configurable permission presets on top of the
-- built-in UserRole enum. Additive only; existing rows stay untouched.

-- 1) New column on `staff` — nullable FK to custom_roles.
ALTER TABLE "staff"
  ADD COLUMN "customRoleId" TEXT;

-- 2) New table — branch-scoped.
CREATE TABLE "custom_roles" (
  "id"                TEXT         NOT NULL PRIMARY KEY,
  "branchId"          TEXT         NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "name"              TEXT         NOT NULL,
  "description"       TEXT,
  "baseRole"          "UserRole"   NOT NULL,
  "adminNavOverrides" JSONB,
  "posPermissions"    JSONB,
  "isActive"          BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "deletedAt"         TIMESTAMP(3)
);
CREATE UNIQUE INDEX "custom_roles_branchId_name_key" ON "custom_roles"("branchId", "name");
CREATE INDEX         "custom_roles_branchId_idx"     ON "custom_roles"("branchId");

-- 3) Staff → CustomRole FK. SET NULL on delete so soft-deleting a role
-- doesn't cascade-break assigned staff rows.
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_customRoleId_fkey"
  FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id") ON DELETE SET NULL;
