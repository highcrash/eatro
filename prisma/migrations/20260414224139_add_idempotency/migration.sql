-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "responseCode" INTEGER NOT NULL,
    "responseBody" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "idempotency_records_createdAt_idx" ON "idempotency_records"("createdAt");
