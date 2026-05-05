-- Drop the trailing `total` token from the default to match the
-- 3-placeholder shape Meta's auto-approved utility templates use
-- (most "purchase_order_v1" templates have only {{1}} {{2}} {{3}}).
-- Existing rows already at the prior 4-token default get rewritten to
-- the new 3-token default so they stop hitting #132000 — admins who
-- intentionally chose a different ordered list (anything other than the
-- old default) keep their custom value untouched.
ALTER TABLE "branch_settings"
  ALTER COLUMN "whatsappPoTemplateParams" SET DEFAULT 'supplierName,poNumber,date';

UPDATE "branch_settings"
  SET "whatsappPoTemplateParams" = 'supplierName,poNumber,date'
  WHERE "whatsappPoTemplateParams" = 'supplierName,poNumber,date,total';
