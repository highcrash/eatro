-- AlterTable
ALTER TABLE "website_content" ADD COLUMN     "maintenanceBg" TEXT,
ADD COLUMN     "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maintenanceText" TEXT,
ADD COLUMN     "notFoundBg" TEXT,
ADD COLUMN     "notFoundText" TEXT;
