-- Custom Facebook caption template per branch. Null = use the
-- hard-coded default in apps/api/src/social/caption.ts.
ALTER TABLE "branch_settings"
  ADD COLUMN "fbCaptionTemplate" TEXT;
