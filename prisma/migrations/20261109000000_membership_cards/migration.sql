CREATE TYPE "MembershipCardStatus" AS ENUM ('IN_STOCK', 'ACTIVE', 'BLOCKED');
CREATE TYPE "MembershipRuleKind" AS ENUM ('EXCLUDE', 'SPECIAL');

ALTER TABLE "orders" ADD COLUMN "membershipCardId" TEXT;
ALTER TABLE "orders" ADD COLUMN "membershipCardCode" TEXT;

CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "validityMonths" INTEGER NOT NULL DEFAULT 12,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "membership_plan_rules" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "categoryId" TEXT,
    "kind" "MembershipRuleKind" NOT NULL,
    "type" "DiscountType",
    "value" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "membership_plan_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "membership_cards" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "status" "MembershipCardStatus" NOT NULL DEFAULT 'IN_STOCK',
    "batchLabel" TEXT,
    "customerId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membership_cards_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "membership_plans_branchId_idx" ON "membership_plans"("branchId");
CREATE INDEX "membership_plan_rules_planId_idx" ON "membership_plan_rules"("planId");
CREATE UNIQUE INDEX "membership_plan_rules_planId_menuItemId_key" ON "membership_plan_rules"("planId", "menuItemId");
CREATE UNIQUE INDEX "membership_plan_rules_planId_categoryId_key" ON "membership_plan_rules"("planId", "categoryId");
CREATE UNIQUE INDEX "membership_cards_number_key" ON "membership_cards"("number");
CREATE UNIQUE INDEX "membership_cards_branchId_serial_key" ON "membership_cards"("branchId", "serial");
CREATE INDEX "membership_cards_branchId_status_idx" ON "membership_cards"("branchId", "status");
CREATE INDEX "membership_cards_customerId_idx" ON "membership_cards"("customerId");

ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_plan_rules" ADD CONSTRAINT "membership_plan_rules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_plan_rules" ADD CONSTRAINT "membership_plan_rules_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_plan_rules" ADD CONSTRAINT "membership_plan_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_cards" ADD CONSTRAINT "membership_cards_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_cards" ADD CONSTRAINT "membership_cards_planId_fkey" FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "membership_cards" ADD CONSTRAINT "membership_cards_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "membership_cards" ADD CONSTRAINT "membership_cards_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "membership_cards" ADD CONSTRAINT "membership_cards_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "membership_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
