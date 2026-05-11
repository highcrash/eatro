-- CreateEnum
CREATE TYPE "SalaryComponentType" AS ENUM ('EARNING', 'DEDUCTION');

-- AlterTable: staff — link to optional salary structure + leave rule
ALTER TABLE "staff" ADD COLUMN "salaryStructureId" TEXT;
ALTER TABLE "staff" ADD COLUMN "leaveRuleId" TEXT;

-- AlterTable: payrolls — frozen structure snapshot per run
ALTER TABLE "payrolls" ADD COLUMN "structureSnapshot" JSONB;

-- CreateTable: salary_structures
CREATE TABLE "salary_structures" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "latesPerAbsent" INTEGER NOT NULL DEFAULT 3,
    "halfDaysPerAbsent" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "salary_structures_branchId_idx" ON "salary_structures"("branchId");

-- CreateTable: salary_components
CREATE TABLE "salary_components" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SalaryComponentType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "salary_components_structureId_idx" ON "salary_components"("structureId");

-- CreateTable: leave_rules
CREATE TABLE "leave_rules" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "leave_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leave_rules_branchId_idx" ON "leave_rules"("branchId");

-- CreateTable: leave_rule_entries
CREATE TABLE "leave_rule_entries" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "accrualPerMonth" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "annualGrant" INTEGER NOT NULL DEFAULT 0,
    "balanceCap" INTEGER,

    CONSTRAINT "leave_rule_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_rule_entries_ruleId_leaveType_key" ON "leave_rule_entries"("ruleId", "leaveType");

-- CreateTable: leave_balances
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "leaveType" "LeaveType" NOT NULL,
    "balance" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "lastAccrualAt" TIMESTAMP(3),
    "lastAnnualGrantAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_balances_staffId_leaveType_key" ON "leave_balances"("staffId", "leaveType");
CREATE INDEX "leave_balances_branchId_idx" ON "leave_balances"("branchId");

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "salary_structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff" ADD CONSTRAINT "staff_leaveRuleId_fkey" FOREIGN KEY ("leaveRuleId") REFERENCES "leave_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "salary_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_rules" ADD CONSTRAINT "leave_rules_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_rule_entries" ADD CONSTRAINT "leave_rule_entries_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "leave_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
