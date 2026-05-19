-- Add ATTENDANCE to the ActivityCategory enum so manual edits on
-- AttendancePage (mark / clearOverride) write audit entries the
-- admin can review.
ALTER TYPE "ActivityCategory" ADD VALUE 'ATTENDANCE';
