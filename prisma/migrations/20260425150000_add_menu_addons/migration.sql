-- Phase 3 — Menu addons / modifiers.
-- A MenuItem can act as an addon (Extra Patty, Cheese Sauce, Garlic Nun)
-- when isAddon=true. Addons are filtered from the main POS grid + the
-- website / QR feed; selectable only via an addon group on a parent item.
-- Each addon is a real MenuItem with its own price + recipe so the
-- existing pricing / cost / stock-deduction engines keep working.
--
-- All columns are nullable / default-false so existing rows behave
-- identically until admin attaches an addon group.

ALTER TABLE "menu_items"
  ADD COLUMN "isAddon" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "menu_item_addon_groups" (
  "id"          TEXT         NOT NULL,
  "branchId"    TEXT         NOT NULL,
  "menuItemId"  TEXT         NOT NULL,
  "name"        TEXT         NOT NULL,
  "minPicks"    INTEGER      NOT NULL DEFAULT 0,
  "maxPicks"    INTEGER      NOT NULL DEFAULT 1,
  "sortOrder"   INTEGER      NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),
  CONSTRAINT "menu_item_addon_groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "menu_item_addon_groups_menuItemId_idx" ON "menu_item_addon_groups"("menuItemId");

ALTER TABLE "menu_item_addon_groups"
  ADD CONSTRAINT "menu_item_addon_groups_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "menu_item_addon_groups"
  ADD CONSTRAINT "menu_item_addon_groups_menuItemId_fkey"
  FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "menu_item_addon_options" (
  "id"          TEXT    NOT NULL,
  "groupId"     TEXT    NOT NULL,
  "addonItemId" TEXT    NOT NULL,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "menu_item_addon_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "menu_item_addon_options_groupId_addonItemId_key"
  ON "menu_item_addon_options"("groupId", "addonItemId");

ALTER TABLE "menu_item_addon_options"
  ADD CONSTRAINT "menu_item_addon_options_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "menu_item_addon_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "menu_item_addon_options"
  ADD CONSTRAINT "menu_item_addon_options_addonItemId_fkey"
  FOREIGN KEY ("addonItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD COLUMN "addons" JSONB;
