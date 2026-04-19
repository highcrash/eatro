-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "LicenseCheckAction" AS ENUM ('ACTIVATE', 'VERIFY', 'DEACTIVATE', 'ASSERT', 'BLOCKED');

-- CreateTable
CREATE TABLE "license_records" (
    "id" TEXT NOT NULL DEFAULT 'self',
    "licenseId" TEXT NOT NULL,
    "purchaseCodeTail" TEXT NOT NULL,
    "activatedDomain" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "hmacSecretEnc" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'PENDING',
    "signedProof" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "verdictHmac" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "license_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_check_logs" (
    "id" TEXT NOT NULL,
    "action" "LicenseCheckAction" NOT NULL,
    "result" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "path" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_check_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "license_records_licenseId_key" ON "license_records"("licenseId");

-- CreateIndex
CREATE INDEX "license_check_logs_at_idx" ON "license_check_logs"("at");

-- CreateIndex
CREATE INDEX "license_check_logs_action_at_idx" ON "license_check_logs"("action", "at");
