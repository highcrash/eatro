-- Table-status timers + QR self-service ingredient removal toggle.
-- All columns are additive nullable / default values so existing rows
-- behave identically.

ALTER TABLE "branch_settings"
  ADD COLUMN "qrAllowSelfRemoveIngredients" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "tableTimerOrderToStartMin"   INTEGER DEFAULT 30,
  ADD COLUMN "tableTimerStartToDoneMin"    INTEGER DEFAULT 40,
  ADD COLUMN "tableTimerServedToClearMin"  INTEGER DEFAULT 35;

ALTER TABLE "orders"
  ADD COLUMN "firstKitchenStartAt" TIMESTAMP(3),
  ADD COLUMN "firstKitchenDoneAt"  TIMESTAMP(3);
