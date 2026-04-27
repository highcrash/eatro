-- Liabilities (Creditors) — non-supplier debts: utilities, rent, loans, etc.
-- Mirrors the Supplier ledger shape but stays out of purchasing reports.
-- Pure additive: four new tables + one new enum, no changes to existing data.

CREATE TYPE "CreditorCategory" AS ENUM ('UTILITY', 'LANDLORD', 'BANK', 'INDIVIDUAL', 'OTHER');

CREATE TABLE "creditors" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CreditorCategory" NOT NULL DEFAULT 'OTHER',
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "defaultExpenseCategory" "ExpenseCategory" NOT NULL DEFAULT 'MISCELLANEOUS',
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "creditors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "creditors_branchId_isActive_idx" ON "creditors"("branchId", "isActive");

ALTER TABLE "creditors"
  ADD CONSTRAINT "creditors_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "creditor_bills" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creditor_bills_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "creditor_bills_branchId_creditorId_idx" ON "creditor_bills"("branchId", "creditorId");

ALTER TABLE "creditor_bills"
  ADD CONSTRAINT "creditor_bills_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "creditor_bills"
  ADD CONSTRAINT "creditor_bills_creditorId_fkey"
  FOREIGN KEY ("creditorId") REFERENCES "creditors"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "creditor_bills"
  ADD CONSTRAINT "creditor_bills_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "staff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "creditor_payments" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "notes" TEXT,
    "paidById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creditor_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "creditor_payments_branchId_creditorId_idx" ON "creditor_payments"("branchId", "creditorId");

ALTER TABLE "creditor_payments"
  ADD CONSTRAINT "creditor_payments_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "creditor_payments"
  ADD CONSTRAINT "creditor_payments_creditorId_fkey"
  FOREIGN KEY ("creditorId") REFERENCES "creditors"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "creditor_payments"
  ADD CONSTRAINT "creditor_payments_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "staff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "creditor_adjustments" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creditor_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "creditor_adjustments_branchId_creditorId_idx" ON "creditor_adjustments"("branchId", "creditorId");

ALTER TABLE "creditor_adjustments"
  ADD CONSTRAINT "creditor_adjustments_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "creditor_adjustments"
  ADD CONSTRAINT "creditor_adjustments_creditorId_fkey"
  FOREIGN KEY ("creditorId") REFERENCES "creditors"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "creditor_adjustments"
  ADD CONSTRAINT "creditor_adjustments_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "staff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
