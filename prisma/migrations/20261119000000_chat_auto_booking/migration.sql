-- Chat bookings: held until the number is verified, then confirmed automatically for small groups.
ALTER TABLE "chat_conversations" ADD COLUMN "pendingBooking" JSONB;
ALTER TABLE "chatbot_settings" ADD COLUMN "bookingAutoConfirm" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "bookingAutoConfirmMaxGuests" INTEGER NOT NULL DEFAULT 10;
