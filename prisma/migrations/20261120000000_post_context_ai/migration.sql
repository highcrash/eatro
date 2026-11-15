-- The AI reads a post's caption and photo when no dish name matches.
ALTER TABLE "chat_post_contexts" ADD COLUMN "aiCheckedAt" TIMESTAMP(3);
