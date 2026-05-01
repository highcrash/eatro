-- Auto-Facebook-post integration for menu discounts.
-- Pure additive: 1 enum + 6 columns on branch_settings + 1 new table.

-- CreateEnum
CREATE TYPE "FbPostStatus" AS ENUM ('PENDING', 'POSTED', 'CANCELLED', 'FAILED');

-- AlterTable: BranchSetting — Facebook page connection + default post time.
ALTER TABLE "branch_settings"
  ADD COLUMN "fbAutopostEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fbPageId"          TEXT,
  ADD COLUMN "fbPageName"        TEXT,
  ADD COLUMN "fbPageAccessToken" TEXT,
  ADD COLUMN "fbConnectedAt"     TIMESTAMP(3),
  ADD COLUMN "fbDefaultPostTime" TEXT NOT NULL DEFAULT '11:00';

-- CreateTable: scheduled_fb_posts — queue of pending / sent / failed posts.
CREATE TABLE "scheduled_fb_posts" (
    "id"              TEXT NOT NULL,
    "branchId"        TEXT NOT NULL,
    "menuDiscountId"  TEXT,
    "status"          "FbPostStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt"     TIMESTAMP(3) NOT NULL,
    "postedAt"        TIMESTAMP(3),
    "fbPostId"        TEXT,
    "message"         TEXT NOT NULL,
    "imagePath"       TEXT NOT NULL,
    "attempts"        INTEGER NOT NULL DEFAULT 0,
    "lastError"       TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_fb_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: cron picks up due rows by (status, scheduledAt) within a branch.
CREATE INDEX "scheduled_fb_posts_branchId_status_scheduledAt_idx"
  ON "scheduled_fb_posts"("branchId", "status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "scheduled_fb_posts"
  ADD CONSTRAINT "scheduled_fb_posts_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: discount can be hard-deleted without cascading; the queue
-- row keeps its image + caption so admin can still review history.
ALTER TABLE "scheduled_fb_posts"
  ADD CONSTRAINT "scheduled_fb_posts_menuDiscountId_fkey"
  FOREIGN KEY ("menuDiscountId") REFERENCES "menu_item_discounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
