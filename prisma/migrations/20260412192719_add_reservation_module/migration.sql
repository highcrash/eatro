-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'ARRIVED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- AlterTable
ALTER TABLE "branch_settings" ADD COLUMN     "closingTime" TEXT NOT NULL DEFAULT '23:00',
ADD COLUMN     "openingTime" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "reservationAutoReserveMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "reservationBlockMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "reservationLateThresholdMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "reservationMaxBookingsPerSlot" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "reservationMaxPersonsPerSlot" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "reservationReminderMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "reservationSlotMinutes" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "reservationSmsConfirmTemplate" TEXT,
ADD COLUMN     "reservationSmsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reservationSmsRejectTemplate" TEXT,
ADD COLUMN     "reservationSmsReminderTemplate" TEXT,
ADD COLUMN     "reservationTermsOfService" TEXT;

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "timeSlot" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "tableId" TEXT,
    "notes" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "agreedTerms" BOOLEAN NOT NULL DEFAULT true,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservations_branchId_date_status_idx" ON "reservations"("branchId", "date", "status");

-- CreateIndex
CREATE INDEX "reservations_branchId_status_idx" ON "reservations"("branchId", "status");

-- CreateIndex
CREATE INDEX "reservations_customerPhone_idx" ON "reservations"("customerPhone");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
