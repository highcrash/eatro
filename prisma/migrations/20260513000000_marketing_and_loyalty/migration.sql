-- CreateEnum
CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARNED', 'REDEEMED', 'EXPIRED', 'ADJUSTMENT');
CREATE TYPE "CouponCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT');

-- AlterTable: customers — loyalty balance + rolling expiry
ALTER TABLE "customers" ADD COLUMN "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN "loyaltyExpiresAt" TIMESTAMP(3);

-- AlterTable: coupons — per-customer scoping + campaign tag
ALTER TABLE "coupons" ADD COLUMN "customerId" TEXT;
ALTER TABLE "coupons" ADD COLUMN "campaignTag" TEXT;

CREATE INDEX "coupons_customerId_idx" ON "coupons"("customerId");
CREATE INDEX "coupons_campaignTag_idx" ON "coupons"("campaignTag");

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: branch_settings — loyalty + first-visit fields
ALTER TABLE "branch_settings" ADD COLUMN "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "branch_settings" ADD COLUMN "loyaltyTakaPerPoint" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "branch_settings" ADD COLUMN "loyaltyTakaPerPointRedeem" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "branch_settings" ADD COLUMN "loyaltyValidityDays" INTEGER NOT NULL DEFAULT 180;
ALTER TABLE "branch_settings" ADD COLUMN "firstVisitCouponEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "branch_settings" ADD COLUMN "firstVisitCouponType" "DiscountType" NOT NULL DEFAULT 'PERCENTAGE';
ALTER TABLE "branch_settings" ADD COLUMN "firstVisitCouponValue" DECIMAL(14,2) NOT NULL DEFAULT 10;
ALTER TABLE "branch_settings" ADD COLUMN "firstVisitCouponValidityDays" INTEGER NOT NULL DEFAULT 30;

-- CreateTable: loyalty_transactions
CREATE TABLE "loyalty_transactions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "points" INTEGER NOT NULL,
    "type" "LoyaltyTransactionType" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loyalty_transactions_customerId_createdAt_idx" ON "loyalty_transactions"("customerId", "createdAt");
CREATE INDEX "loyalty_transactions_branchId_createdAt_idx" ON "loyalty_transactions"("branchId", "createdAt");

ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: coupon_campaigns
CREATE TABLE "coupon_campaigns" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CouponCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "filterSummary" TEXT,
    "couponType" "DiscountType" NOT NULL,
    "couponValue" DECIMAL(14,2) NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "smsTemplate" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "coupon_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coupon_campaigns_branchId_createdAt_idx" ON "coupon_campaigns"("branchId", "createdAt");

ALTER TABLE "coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
