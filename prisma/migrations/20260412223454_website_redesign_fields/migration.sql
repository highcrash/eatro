-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "showOnWebsite" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "menu_categories" ADD COLUMN     "websiteVisible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "pieces" TEXT,
ADD COLUMN     "prepTime" TEXT,
ADD COLUMN     "spiceLevel" TEXT,
ADD COLUMN     "websiteVisible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "website_content" ADD COLUMN     "aboutPoint1" TEXT,
ADD COLUMN     "aboutPoint2" TEXT,
ADD COLUMN     "aboutPoint3" TEXT,
ADD COLUMN     "aboutPoint4" TEXT,
ADD COLUMN     "aboutSectionBg" TEXT,
ADD COLUMN     "accentColor" TEXT NOT NULL DEFAULT '#D62B2B',
ADD COLUMN     "bannerBg" TEXT,
ADD COLUMN     "bannerText" TEXT,
ADD COLUMN     "bgColor" TEXT,
ADD COLUMN     "buttonColor" TEXT NOT NULL DEFAULT '#D62B2B',
ADD COLUMN     "contactSectionBg" TEXT,
ADD COLUMN     "galleryImages" TEXT,
ADD COLUMN     "heroVideoUrl" TEXT,
ADD COLUMN     "hiddenCategoryIds" TEXT,
ADD COLUMN     "hiddenItemIds" TEXT,
ADD COLUMN     "menuSectionBg" TEXT,
ADD COLUMN     "openingHours" TEXT,
ADD COLUMN     "recommendedTag" TEXT NOT NULL DEFAULT 'Chef Special',
ADD COLUMN     "reservationSectionBg" TEXT,
ADD COLUMN     "reviewsSectionBg" TEXT,
ADD COLUMN     "showGallery" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showKeyIngredients" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showPieces" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showPrepTime" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showReservation" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showReviews" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showSpiceLevel" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "textColor" TEXT,
ADD COLUMN     "websiteMode" TEXT NOT NULL DEFAULT 'dark';
