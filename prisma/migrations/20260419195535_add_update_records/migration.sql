-- CreateEnum
CREATE TYPE "UpdateStatus" AS ENUM ('STAGED', 'APPLYING', 'APPLIED', 'ROLLED_BACK', 'FAILED');

-- CreateTable
CREATE TABLE "update_records" (
    "id" TEXT NOT NULL,
    "toVersion" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "status" "UpdateStatus" NOT NULL DEFAULT 'STAGED',
    "stagingPath" TEXT NOT NULL,
    "backupRecordId" TEXT,
    "zipSha256" TEXT NOT NULL,
    "notes" TEXT,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "update_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "update_records_uploadedAt_idx" ON "update_records"("uploadedAt");

-- CreateIndex
CREATE INDEX "update_records_status_uploadedAt_idx" ON "update_records"("status", "uploadedAt");
