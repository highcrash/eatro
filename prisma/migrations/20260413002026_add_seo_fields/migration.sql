-- AlterTable
ALTER TABLE "menu_categories" ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "seoTitle" TEXT,
ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "website_content" ADD COLUMN     "seoAboutDescription" TEXT,
ADD COLUMN     "seoAboutTitle" TEXT,
ADD COLUMN     "seoContactDescription" TEXT,
ADD COLUMN     "seoContactTitle" TEXT,
ADD COLUMN     "seoFavicon" TEXT,
ADD COLUMN     "seoHomeDescription" TEXT,
ADD COLUMN     "seoHomeKeywords" TEXT,
ADD COLUMN     "seoHomeTitle" TEXT,
ADD COLUMN     "seoMenuDescription" TEXT,
ADD COLUMN     "seoMenuTitle" TEXT,
ADD COLUMN     "seoOgImage" TEXT,
ADD COLUMN     "seoReservationDescription" TEXT,
ADD COLUMN     "seoReservationTitle" TEXT,
ADD COLUMN     "seoSiteName" TEXT;
