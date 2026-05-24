-- Mobile shopping-request flow: staff submit a list (with optional
-- per-line mismatch flags), admin approves to spawn DRAFT POs grouped
-- by supplier and to fire WasteLog / ADJUSTMENT writes for mismatches.

-- New enums --------------------------------------------------------
CREATE TYPE "MismatchReason" AS ENUM ('WASTE', 'MISCALCULATION', 'MISSING_PURCHASE', 'ADJUSTMENT');
CREATE TYPE "ShoppingRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- WasteLog gets an optional photo URL ------------------------------
ALTER TABLE "waste_logs" ADD COLUMN "photoUrl" TEXT;

-- ShoppingRequest header -------------------------------------------
CREATE TABLE "shopping_requests" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ShoppingRequestStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shopping_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shopping_requests_branchId_status_createdAt_idx"
  ON "shopping_requests"("branchId", "status", "createdAt");
ALTER TABLE "shopping_requests" ADD CONSTRAINT "shopping_requests_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shopping_requests" ADD CONSTRAINT "shopping_requests_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shopping_requests" ADD CONSTRAINT "shopping_requests_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ShoppingRequestLine ----------------------------------------------
CREATE TABLE "shopping_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "requestedQuantity" DECIMAL(14, 3),
    "physicalCount" DECIMAL(14, 3),
    "softwareCountAtTime" DECIMAL(14, 3),
    "mismatchReason" "MismatchReason",
    "mismatchPhotoUrl" TEXT,
    "mismatchNotes" TEXT,
    "unitCostPaisa" INTEGER,
    "supplierId" TEXT,
    "purchaseOrderId" TEXT,
    "wasteLogId" TEXT,
    "adjustmentMovementId" TEXT,
    CONSTRAINT "shopping_request_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shopping_request_lines_requestId_idx" ON "shopping_request_lines"("requestId");
CREATE INDEX "shopping_request_lines_ingredientId_idx" ON "shopping_request_lines"("ingredientId");
CREATE UNIQUE INDEX "shopping_request_lines_wasteLogId_key" ON "shopping_request_lines"("wasteLogId");
CREATE UNIQUE INDEX "shopping_request_lines_adjustmentMovementId_key" ON "shopping_request_lines"("adjustmentMovementId");
ALTER TABLE "shopping_request_lines" ADD CONSTRAINT "shopping_request_lines_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "shopping_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shopping_request_lines" ADD CONSTRAINT "shopping_request_lines_ingredientId_fkey"
  FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shopping_request_lines" ADD CONSTRAINT "shopping_request_lines_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shopping_request_lines" ADD CONSTRAINT "shopping_request_lines_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shopping_request_lines" ADD CONSTRAINT "shopping_request_lines_wasteLogId_fkey"
  FOREIGN KEY ("wasteLogId") REFERENCES "waste_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shopping_request_lines" ADD CONSTRAINT "shopping_request_lines_adjustmentMovementId_fkey"
  FOREIGN KEY ("adjustmentMovementId") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
