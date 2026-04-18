-- CreateEnum
CREATE TYPE "PurchaseCodeSource" AS ENUM ('IMPORTED', 'MANUAL', 'GRANT');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CheckAction" AS ENUM ('ACTIVATE', 'VERIFY', 'DEACTIVATE', 'BLOCKED', 'ROTATE');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'STAFF');

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "envatoItemId" TEXT,
    "envatoLastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_codes" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "source" "PurchaseCodeSource" NOT NULL,
    "notes" TEXT,
    "maxActivations" INTEGER NOT NULL DEFAULT 1,
    "usedActivations" INTEGER NOT NULL DEFAULT 0,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "envatoBuyer" TEXT,
    "envatoSoldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "purchaseCodeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "hmacSecretEnc" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'PENDING',
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_logs" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT,
    "productId" TEXT,
    "action" "CheckAction" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "result" TEXT NOT NULL,
    "detail" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'OWNER',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signing_keys" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "ed25519PrivateKeyEnc" TEXT NOT NULL,
    "ed25519PublicKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "retiresAt" TIMESTAMP(3),

    CONSTRAINT "signing_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_codes_code_key" ON "purchase_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_codes_codeHash_key" ON "purchase_codes"("codeHash");

-- CreateIndex
CREATE INDEX "purchase_codes_productId_isRevoked_idx" ON "purchase_codes"("productId", "isRevoked");

-- CreateIndex
CREATE INDEX "purchase_codes_codeHash_idx" ON "purchase_codes"("codeHash");

-- CreateIndex
CREATE INDEX "licenses_productId_status_idx" ON "licenses"("productId", "status");

-- CreateIndex
CREATE INDEX "licenses_domain_idx" ON "licenses"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_purchaseCodeId_domain_fingerprint_key" ON "licenses"("purchaseCodeId", "domain", "fingerprint");

-- CreateIndex
CREATE INDEX "check_logs_licenseId_at_idx" ON "check_logs"("licenseId", "at" DESC);

-- CreateIndex
CREATE INDEX "check_logs_action_at_idx" ON "check_logs"("action", "at" DESC);

-- CreateIndex
CREATE INDEX "check_logs_ip_at_idx" ON "check_logs"("ip", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "signing_keys_kid_key" ON "signing_keys"("kid");

-- CreateIndex
CREATE INDEX "signing_keys_productId_isActive_idx" ON "signing_keys"("productId", "isActive");

-- AddForeignKey
ALTER TABLE "purchase_codes" ADD CONSTRAINT "purchase_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_purchaseCodeId_fkey" FOREIGN KEY ("purchaseCodeId") REFERENCES "purchase_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_logs" ADD CONSTRAINT "check_logs_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signing_keys" ADD CONSTRAINT "signing_keys_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
