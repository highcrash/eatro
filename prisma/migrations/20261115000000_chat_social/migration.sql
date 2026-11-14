-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "CommentKind" AS ENUM ('PRICE', 'BOOKING', 'INFO', 'PRAISE', 'COMPLAINT', 'SPAM', 'ABUSE', 'IGNORE', 'OTHER');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('NEW', 'DRAFT', 'REPLIED', 'ESCALATED', 'IGNORED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ComplaintLevel" AS ENUM ('SERIOUS', 'ORDINARY', 'MILD');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('NEW', 'CONTACTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ComplaintResponseMode" AS ENUM ('DRAFT', 'HOLDING', 'STAFF_ONLY');

-- AlterTable
ALTER TABLE "chatbot_settings" ADD COLUMN     "autoHideSpam" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commentHourlyCap" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "commentMode" "ChatMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "complaintMode" "ComplaintResponseMode" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "complaintReminderMins" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "complaintSmsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "managerPhone" TEXT;

-- CreateTable
CREATE TABLE "meta_app_settings" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "appId" TEXT,
    "appSecretEnc" TEXT,
    "verifyToken" TEXT NOT NULL,
    "igUserId" TEXT,
    "igUsername" TEXT,
    "grantedScopes" JSONB,
    "pendingPages" JSONB,
    "pendingUntil" TIMESTAMP(3),
    "appSubscribedAt" TIMESTAMP(3),
    "pageSubscribedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastError" TEXT,
    "health" JSONB,
    "healthCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_comments" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "postId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "text" TEXT NOT NULL,
    "kind" "CommentKind" NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'NEW',
    "draftPublicReply" TEXT,
    "draftPrivateReply" TEXT,
    "publicReply" TEXT,
    "publicReplyId" TEXT,
    "privateReplySent" BOOLEAN NOT NULL DEFAULT false,
    "liked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "handledById" TEXT,
    "lastError" TEXT,
    "commentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_post_contexts" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "postId" TEXT NOT NULL,
    "caption" TEXT,
    "permalink" TEXT,
    "menuItemIds" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_post_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_complaints" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "commentId" TEXT,
    "conversationId" TEXT,
    "channel" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "text" TEXT NOT NULL,
    "level" "ComplaintLevel" NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'OTHER',
    "status" "ComplaintStatus" NOT NULL DEFAULT 'NEW',
    "draftReply" TEXT,
    "notes" TEXT,
    "outcome" TEXT,
    "assignedStaffId" TEXT,
    "openedAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "managerSmsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_complaints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_app_settings_branchId_key" ON "meta_app_settings"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_comments_commentId_key" ON "chat_comments"("commentId");

-- CreateIndex
CREATE INDEX "chat_comments_branchId_status_createdAt_idx" ON "chat_comments"("branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "chat_comments_branchId_postId_authorId_idx" ON "chat_comments"("branchId", "postId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_post_contexts_postId_key" ON "chat_post_contexts"("postId");

-- CreateIndex
CREATE INDEX "chat_post_contexts_branchId_idx" ON "chat_post_contexts"("branchId");

-- CreateIndex
CREATE INDEX "chat_complaints_branchId_status_createdAt_idx" ON "chat_complaints"("branchId", "status", "createdAt");

