-- Add marketing-tag fields to website_content. Admin pastes the raw
-- IDs (not full snippets); the public website injects the standard
-- loader scripts at runtime.
ALTER TABLE "website_content"
  ADD COLUMN "fbPixelId" TEXT,
  ADD COLUMN "googleAnalyticsId" TEXT;
