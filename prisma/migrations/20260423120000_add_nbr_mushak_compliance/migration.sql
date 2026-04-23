-- NBR (Bangladesh) VAT compliance: Mushak 6.3 invoices + 6.8 credit/debit notes
-- + per-branch + FY atomic sequence. `nbrEnabled=false` keeps behaviour identical
-- for non-Bangladesh deployments.

-- 1) Extend OrderStatus + add new enums
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

CREATE TYPE "MushakNoteType" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "RefundReason" AS ENUM ('CUSTOMER_RETURN', 'PRICING_ERROR', 'DUPLICATE', 'DAMAGED', 'OTHER');

-- 2) Branch — NBR toggle + seller identity columns
ALTER TABLE "branches"
  ADD COLUMN "nbrEnabled"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "branchCode"        TEXT,
  ADD COLUMN "sellerLegalName"   TEXT,
  ADD COLUMN "sellerTradingName" TEXT;

-- 3) Sequence counter — atomic per (branch, FY, docKind)
CREATE TABLE "mushak_sequences" (
  "id"         TEXT         NOT NULL PRIMARY KEY,
  "branchId"   TEXT         NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "fiscalYear" TEXT         NOT NULL,
  "docKind"    TEXT         NOT NULL,
  "lastSeq"    INTEGER      NOT NULL DEFAULT 0,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "mushak_sequences_branchId_fiscalYear_docKind_key"
  ON "mushak_sequences"("branchId", "fiscalYear", "docKind");

-- 4) Invoice (Mushak-6.3) archive — one per paid order
CREATE TABLE "mushak_invoices" (
  "id"              TEXT           NOT NULL PRIMARY KEY,
  "branchId"        TEXT           NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "orderId"         TEXT           NOT NULL UNIQUE REFERENCES "orders"("id") ON DELETE RESTRICT,
  "serial"          TEXT           NOT NULL UNIQUE,
  "fiscalYear"      TEXT           NOT NULL,
  "branchCode"      TEXT           NOT NULL,
  "seq"             INTEGER        NOT NULL,
  "formVersion"     TEXT           NOT NULL DEFAULT '6.3',
  "issuedAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "buyerName"       TEXT,
  "buyerPhone"      TEXT,
  "buyerAddress"    TEXT,
  "buyerBin"        TEXT,
  "subtotalExclVat" DECIMAL(14, 2) NOT NULL,
  "sdAmount"        DECIMAL(14, 2) NOT NULL DEFAULT 0,
  "vatAmount"       DECIMAL(14, 2) NOT NULL,
  "totalInclVat"    DECIMAL(14, 2) NOT NULL,
  "snapshot"        JSONB          NOT NULL,
  "createdAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "mushak_invoices_branchId_fiscalYear_seq_key"
  ON "mushak_invoices"("branchId", "fiscalYear", "seq");
CREATE INDEX "mushak_invoices_branchId_issuedAt_idx"
  ON "mushak_invoices"("branchId", "issuedAt");

-- 5) Credit/debit note (Mushak-6.8) — one per refund (full or partial)
CREATE TABLE "mushak_notes" (
  "id"              TEXT             NOT NULL PRIMARY KEY,
  "branchId"        TEXT             NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "invoiceId"       TEXT             NOT NULL REFERENCES "mushak_invoices"("id") ON DELETE RESTRICT,
  "orderId"         TEXT             NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "serial"          TEXT             NOT NULL UNIQUE,
  "fiscalYear"      TEXT             NOT NULL,
  "branchCode"      TEXT             NOT NULL,
  "seq"             INTEGER          NOT NULL,
  "formVersion"     TEXT             NOT NULL DEFAULT '6.8',
  "noteType"        "MushakNoteType" NOT NULL,
  "reasonCode"      "RefundReason"   NOT NULL,
  "reasonText"      TEXT,
  "issuedAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedById"      TEXT             NOT NULL REFERENCES "staff"("id") ON DELETE RESTRICT,
  "subtotalExclVat" DECIMAL(14, 2)   NOT NULL,
  "sdAmount"        DECIMAL(14, 2)   NOT NULL DEFAULT 0,
  "vatAmount"       DECIMAL(14, 2)   NOT NULL,
  "totalInclVat"    DECIMAL(14, 2)   NOT NULL,
  "refundedItemIds" JSONB            NOT NULL,
  "snapshot"        JSONB            NOT NULL,
  "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "mushak_notes_branchId_fiscalYear_seq_key"
  ON "mushak_notes"("branchId", "fiscalYear", "seq");
CREATE INDEX "mushak_notes_branchId_issuedAt_idx"
  ON "mushak_notes"("branchId", "issuedAt");
CREATE INDEX "mushak_notes_invoiceId_idx"
  ON "mushak_notes"("invoiceId");
