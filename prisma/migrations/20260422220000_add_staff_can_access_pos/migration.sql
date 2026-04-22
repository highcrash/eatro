-- Per-staff gate for POS terminals. Default true so existing users
-- keep access; owners disable on a case-by-case basis for roles that
-- shouldn't be operating a register.
ALTER TABLE "staff"
  ADD COLUMN "canAccessPos" BOOLEAN NOT NULL DEFAULT true;
