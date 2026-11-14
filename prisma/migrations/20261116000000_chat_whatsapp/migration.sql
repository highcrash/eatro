-- AlterTable
ALTER TABLE "chatbot_settings" ADD COLUMN     "whatsappMonthlyCap" INTEGER NOT NULL DEFAULT 1000;

-- AlterTable
ALTER TABLE "meta_app_settings" ADD COLUMN     "whatsappSubscribedAt" TIMESTAMP(3);

