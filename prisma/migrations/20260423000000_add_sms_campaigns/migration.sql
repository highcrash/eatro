-- SMS campaigns + payment notifications

-- New toggle columns on branch_settings for the payment-SMS flow.
ALTER TABLE "branch_settings"
  ADD COLUMN "smsPaymentNotifyEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smsPaymentTemplate" TEXT;

-- Status + kind enums for the log table.
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'EXPIRED');
CREATE TYPE "SmsKind" AS ENUM ('CAMPAIGN', 'PAYMENT', 'RESERVATION', 'OTP', 'OTHER');

CREATE TABLE "sms_logs" (
  "id"          TEXT        NOT NULL PRIMARY KEY,
  "branchId"    TEXT        NOT NULL,
  "toPhone"     TEXT        NOT NULL,
  "body"        TEXT        NOT NULL,
  "kind"        "SmsKind"   NOT NULL DEFAULT 'OTHER',
  "status"      "SmsStatus" NOT NULL DEFAULT 'QUEUED',
  "requestId"   TEXT,
  "errorText"   TEXT,
  "attempts"    INTEGER     NOT NULL DEFAULT 1,
  "customerId"  TEXT,
  "orderId"     TEXT,
  "campaignId"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "lastChecked" TIMESTAMP(3)
);

CREATE INDEX "sms_logs_branchId_createdAt_idx" ON "sms_logs"("branchId", "createdAt");
CREATE INDEX "sms_logs_branchId_status_idx"    ON "sms_logs"("branchId", "status");
CREATE INDEX "sms_logs_campaignId_idx"          ON "sms_logs"("campaignId");

CREATE TABLE "sms_templates" (
  "id"        TEXT         NOT NULL PRIMARY KEY,
  "branchId"  TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "body"      TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "sms_templates_branchId_name_key" ON "sms_templates"("branchId", "name");
CREATE INDEX "sms_templates_branchId_idx"              ON "sms_templates"("branchId");
