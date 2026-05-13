-- CreateTable: external_api_keys — programmatic access for /api/v1/external/*
CREATE TABLE "external_api_keys" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_api_keys_prefix_key" ON "external_api_keys"("prefix");
CREATE INDEX "external_api_keys_branchId_revokedAt_idx" ON "external_api_keys"("branchId", "revokedAt");

-- AddForeignKey
ALTER TABLE "external_api_keys" ADD CONSTRAINT "external_api_keys_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_api_keys" ADD CONSTRAINT "external_api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
