-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "brandName" TEXT,
ADD COLUMN     "hasVariants" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "packSize" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "piecesPerPack" INTEGER,
ADD COLUMN     "sku" TEXT;

-- CreateIndex
CREATE INDEX "ingredients_parentId_idx" ON "ingredients"("parentId");

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
