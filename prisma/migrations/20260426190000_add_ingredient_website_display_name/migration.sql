-- Optional customer-facing alias for an ingredient. When set, the
-- public website menu shows this in place of `name`; null falls back
-- to `name`. Keeps internal inventory names ("Garlic Powder") private
-- while letting the website read better ("Aromatic Garlic"). Pure
-- additive nullable column.

ALTER TABLE "ingredients" ADD COLUMN "websiteDisplayName" TEXT;
