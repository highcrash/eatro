-- Custom-menu margin policy lives on BranchSetting. All three columns
-- are nullable so existing branches default to "no enforced floor /
-- ceiling" — POS Customised Menu falls back to selling price = COGS
-- until admin sets values. % values stored as Decimal(5,2).

ALTER TABLE "branch_settings"
  ADD COLUMN "customMenuCostMargin"      DECIMAL(5, 2),
  ADD COLUMN "customMenuNegotiateMargin" DECIMAL(5, 2),
  ADD COLUMN "customMenuMaxMargin"       DECIMAL(5, 2);

-- Provenance flag for menu items created via POS Customised Menu.
-- Default false leaves all existing rows untouched. UI uses it to
-- filter custom items out of the admin Menu page; website / QR feeds
-- continue to honour the existing websiteVisible flag.

ALTER TABLE "menu_items"
  ADD COLUMN "isCustom" BOOLEAN NOT NULL DEFAULT false;
