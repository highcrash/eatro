-- Send Purchase Order PDF to Supplier via WhatsApp.
--
-- Pure additive: 6 columns on branch_settings (Cloud API creds + the
-- template name/lang), 1 nullable column on suppliers (E.164 WA
-- number), 2 nullable columns on purchase_orders (Meta message id +
-- last-sent timestamp). No FK changes, no enum mutation, no row
-- touched.
--
-- Off by default: branch_settings.whatsappEnabled defaults to false
-- so existing branches see no behaviour change. The "Send via
-- WhatsApp" button on the PO page is hidden until admin opts in AND
-- fills in the three required credential fields.

ALTER TABLE "branch_settings"
  ADD COLUMN "whatsappEnabled"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "whatsappPhoneNumberId"  TEXT,
  ADD COLUMN "whatsappWabaId"         TEXT,
  ADD COLUMN "whatsappAccessToken"    TEXT,
  ADD COLUMN "whatsappPoTemplate"     TEXT NOT NULL DEFAULT 'purchase_order_v1',
  ADD COLUMN "whatsappPoTemplateLang" TEXT NOT NULL DEFAULT 'en_US';

ALTER TABLE "suppliers"
  ADD COLUMN "whatsappNumber" TEXT;

ALTER TABLE "purchase_orders"
  ADD COLUMN "whatsappMessageId" TEXT,
  ADD COLUMN "whatsappSentAt"    TIMESTAMP(3);
