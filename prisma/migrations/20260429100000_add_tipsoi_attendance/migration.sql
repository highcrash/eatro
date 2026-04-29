-- Tipsoi attendance integration + branch attendance rules + per-staff
-- shift overrides. Pure additive: one new enum, plus nullable / default-
-- backed columns on three existing tables. Existing rows survive
-- untouched. Default off (BranchSetting.tipsoiEnabled=false) so new
-- installs see no behaviour change.

-- 1. AttendanceSource enum
CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'TIPSOI');

-- 2. Attendance — provenance + manual override + raw synced timestamps
ALTER TABLE "attendance"
  ADD COLUMN "source" "AttendanceSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "manualOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "syncedClockIn" TIMESTAMP(3),
  ADD COLUMN "syncedClockOut" TIMESTAMP(3),
  ADD COLUMN "syncedFromUid" TEXT;

-- 3. Staff — Tipsoi person mapping + per-staff shift overrides
ALTER TABLE "staff"
  ADD COLUMN "tipsoiPersonId" TEXT,
  ADD COLUMN "shiftStart" TEXT,
  ADD COLUMN "shiftEnd" TEXT,
  ADD COLUMN "lateGraceMinutes" INTEGER,
  ADD COLUMN "halfDayAfterMinutes" INTEGER;

-- 4. BranchSetting — Tipsoi config + branch default attendance rules
ALTER TABLE "branch_settings"
  ADD COLUMN "tipsoiEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tipsoiApiToken" TEXT,
  ADD COLUMN "tipsoiApiUrl" TEXT NOT NULL DEFAULT 'https://api-inovace360.com',
  ADD COLUMN "tipsoiLastSyncAt" TIMESTAMP(3),
  ADD COLUMN "tipsoiLastSyncStatus" TEXT,
  ADD COLUMN "attendanceShiftStart" TEXT NOT NULL DEFAULT '10:00',
  ADD COLUMN "attendanceShiftEnd" TEXT NOT NULL DEFAULT '22:00',
  ADD COLUMN "attendanceLateGraceMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "attendanceHalfDayAfterMinutes" INTEGER NOT NULL DEFAULT 180;
