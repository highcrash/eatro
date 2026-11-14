-- Chat: customers verify their mobile number and get a welcome coupon.
ALTER TABLE "chat_conversations" ADD COLUMN "verifiedPhone" TEXT,
ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN "numberInvites" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "numberInviteAt" TIMESTAMP(3);

ALTER TABLE "chatbot_settings" ADD COLUMN "verifyPhoneEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "welcomeCouponEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "welcomeCouponPercent" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "welcomeCouponDays" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "chat_phone_verifications" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_phone_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_phone_verifications_conversationId_createdAt_idx" ON "chat_phone_verifications"("conversationId", "createdAt");
CREATE INDEX "chat_phone_verifications_phone_createdAt_idx" ON "chat_phone_verifications"("phone", "createdAt");

ALTER TABLE "chat_phone_verifications" ADD CONSTRAINT "chat_phone_verifications_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
