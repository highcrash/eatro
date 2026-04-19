-- CreateTable
CREATE TABLE "system_config" (
    "id" TEXT NOT NULL DEFAULT 'self',
    "installedAt" TIMESTAMP(3),
    "brandName" TEXT NOT NULL DEFAULT 'Your Restaurant',
    "siteName" TEXT NOT NULL DEFAULT 'Your Restaurant',
    "logoUrl" TEXT,
    "supportEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);
