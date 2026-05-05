-- WhatsApp PO template body-params shape — comma-separated ordered list of
-- tokens (supplierName / poNumber / date / total / branchName / itemCount /
-- supplierContact). Lets admins match a template whose placeholder count
-- differs from the original 4-param `purchase_order_v1` without code changes
-- (Meta returns #132000 when the count diverges).
ALTER TABLE "branch_settings"
  ADD COLUMN "whatsappPoTemplateParams" TEXT NOT NULL DEFAULT 'supplierName,poNumber,date,total';
