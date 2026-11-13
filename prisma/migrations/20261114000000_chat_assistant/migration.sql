-- CreateEnum
CREATE TYPE "ChatChannel" AS ENUM ('WEB', 'MESSENGER', 'INSTAGRAM', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ChatConversationStatus" AS ENUM ('BOT', 'HUMAN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatSender" AS ENUM ('CUSTOMER', 'BOT', 'STAFF');

-- CreateEnum
CREATE TYPE "ChatMessageStatus" AS ENUM ('SENT', 'DRAFT', 'DISCARDED', 'SHADOW');

-- CreateEnum
CREATE TYPE "ChatMode" AS ENUM ('OFF', 'SUGGEST', 'AUTO');

-- CreateEnum
CREATE TYPE "ChatLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'BOOKED', 'LOST');

-- CreateEnum
CREATE TYPE "AiProviderType" AS ENUM ('OPENAI_COMPATIBLE', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "AiJob" AS ENUM ('CHAT', 'VISION', 'COMMENT');

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "channel" "ChatChannel" NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "customerId" TEXT,
    "status" "ChatConversationStatus" NOT NULL DEFAULT 'BOT',
    "needsStaff" BOOLEAN NOT NULL DEFAULT false,
    "needsStaffReason" TEXT,
    "humanUntil" TIMESTAMP(3),
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "staffUnread" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCustomerMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "ChatSender" NOT NULL,
    "source" TEXT,
    "status" "ChatMessageStatus" NOT NULL DEFAULT 'SENT',
    "text" TEXT NOT NULL,
    "cards" JSONB,
    "hasImage" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "aiConnectionId" TEXT,
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_quick_replies" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_quick_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_rule_versions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_unanswered" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "conversationId" TEXT,
    "question" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_unanswered_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_leads" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "guests" INTEGER NOT NULL,
    "date" TEXT,
    "time" TEXT,
    "occasion" TEXT,
    "quote" JSONB,
    "status" "ChatLeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "reservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatbot_settings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "webMode" "ChatMode" NOT NULL DEFAULT 'OFF',
    "messengerMode" "ChatMode" NOT NULL DEFAULT 'OFF',
    "instagramMode" "ChatMode" NOT NULL DEFAULT 'OFF',
    "whatsappMode" "ChatMode" NOT NULL DEFAULT 'OFF',
    "assistantName" TEXT NOT NULL DEFAULT 'EATRO Assistant',
    "greeting" TEXT NOT NULL DEFAULT 'Hi! I''m the EATRO Assistant. Ask me about our menu, offers, or booking a table.',
    "fallbackText" TEXT NOT NULL DEFAULT 'Thanks for your message. A team member will reply shortly.',
    "partyRules" TEXT,
    "visionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "imageDailyLimit" INTEGER NOT NULL DEFAULT 5,
    "humanPauseHours" INTEGER NOT NULL DEFAULT 12,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "usdRate" DECIMAL(8,2) NOT NULL DEFAULT 122,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_connections" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "AiProviderType" NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEnc" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "monthlyBudget" DECIMAL(12,2),
    "dailyRequestLimit" INTEGER,
    "inputPricePerM" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "outputPricePerM" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "selfTestScore" INTEGER,
    "selfTestAt" TIMESTAMP(3),
    "selfTestDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_routes" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "job" "AiJob" NOT NULL,
    "connectionIds" JSONB NOT NULL,
    "splitConnectionId" TEXT,
    "splitPercent" INTEGER NOT NULL DEFAULT 0,
    "shadowConnectionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "job" "AiJob" NOT NULL,
    "conversationId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_config_history" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_conversations_branchId_lastMessageAt_idx" ON "chat_conversations"("branchId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_conversations_branchId_needsStaff_idx" ON "chat_conversations"("branchId", "needsStaff");

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_branchId_channel_externalUserId_key" ON "chat_conversations"("branchId", "channel", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_externalId_key" ON "chat_messages"("externalId");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_createdAt_idx" ON "chat_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_quick_replies_branchId_isActive_idx" ON "chat_quick_replies"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "chat_rule_versions_branchId_createdAt_idx" ON "chat_rule_versions"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_unanswered_branchId_resolved_createdAt_idx" ON "chat_unanswered"("branchId", "resolved", "createdAt");

-- CreateIndex
CREATE INDEX "chat_leads_branchId_status_createdAt_idx" ON "chat_leads"("branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chatbot_settings_branchId_key" ON "chatbot_settings"("branchId");

-- CreateIndex
CREATE INDEX "ai_connections_branchId_idx" ON "ai_connections"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_routes_branchId_job_key" ON "ai_routes"("branchId", "job");

-- CreateIndex
CREATE INDEX "ai_usage_branchId_createdAt_idx" ON "ai_usage"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_connectionId_createdAt_idx" ON "ai_usage"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_config_history_branchId_createdAt_idx" ON "ai_config_history"("branchId", "createdAt");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_leads" ADD CONSTRAINT "chat_leads_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

