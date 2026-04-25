-- Manual ledger adjustments for suppliers — used to correct wrong
-- opening balances or other ledger discrepancies. Pure ledger-only:
-- adjusts Supplier.totalDue and records an audit row here. Never
-- touches a cash/bank Account or creates an Expense mirror.

CREATE TABLE "supplier_adjustments" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supplier_adjustments_branchId_supplierId_idx"
  ON "supplier_adjustments"("branchId", "supplierId");

ALTER TABLE "supplier_adjustments"
  ADD CONSTRAINT "supplier_adjustments_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_adjustments"
  ADD CONSTRAINT "supplier_adjustments_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_adjustments"
  ADD CONSTRAINT "supplier_adjustments_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "staff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
