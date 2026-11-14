-- Staff chat app: per-staff access switch and web push.
ALTER TABLE "staff" ADD COLUMN "canHandleChats" BOOLEAN NOT NULL DEFAULT false;

-- Cashiers can open the chat inbox in admin today; keep that.
UPDATE "staff" SET "canHandleChats" = true WHERE "role" = 'CASHIER' AND "isActive" = true;

CREATE TABLE "push_keys" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "publicKey" TEXT NOT NULL,
    "privateKeyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_push_subscriptions" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastOkAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_push_subscriptions_endpoint_key" ON "staff_push_subscriptions"("endpoint");
CREATE INDEX "staff_push_subscriptions_branchId_idx" ON "staff_push_subscriptions"("branchId");
CREATE INDEX "staff_push_subscriptions_staffId_idx" ON "staff_push_subscriptions"("staffId");
