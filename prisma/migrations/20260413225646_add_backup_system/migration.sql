-- CreateTable
CREATE TABLE "backup_records" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_schedule" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "frequency" TEXT NOT NULL DEFAULT 'OFF',
    "timeHour" INTEGER NOT NULL DEFAULT 2,
    "retention" INTEGER NOT NULL DEFAULT 10,
    "lastRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_records_createdAt_idx" ON "backup_records"("createdAt");
