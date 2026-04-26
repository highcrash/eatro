# Changelog — Restora POS Desktop

All notable changes to the desktop cashier app are documented here.
Versioning follows SemVer. Tags are `pos-desktop-v{version}`.

## 0.8.34 — Recipes page hides variant parent shells (2026-04-26)

No Electron-shell changes. Rebundles apps/admin + apps/api:

- **Variant parent shells** (e.g. an "Espresso" picker that fans
  out to Espresso – Single + Espresso – Double) **no longer
  appear** in the Recipes menu-item dropdown OR the "copy-from"
  source list. Parents are pickers — they have no price, never
  get sold directly, and the deduction engine reads each
  variant's recipe at order time. Cluttering the list with them
  let admin set unused recipes that did nothing.
- Server-side guard added: `POST /recipes/menu-item/:id` now
  throws `400` if the target is a variant parent, with a clear
  message pointing admin at the variant rows instead.

## 0.8.33 — delete legacy apps/qr (qr-order is the only QR app) (2026-04-26)

No Electron-shell changes. Repo cleanup:

- Removes the **legacy `apps/qr/`** workspace entirely. The
  customer QR-ordering app has lived at `apps/qr-order/` since the
  last rollout — production already routes `/qr` to qr-order via
  Caddy and the codecanyon packager already only ships qr-order.
  The stale `apps/qr/` was a footgun: I accidentally edited it
  earlier this week and the user had to re-test to find the fix
  hadn't landed in production.
- Repoints the root `pnpm dev:qr` script at `@restora/qr-order` so
  developers can't pick the wrong dev server again.
- No code anywhere imports from `@restora/qr` (verified by grep
  before deletion). Caddy + the packager + every changelog entry
  already names qr-order.

## 0.8.32 — admin Recipes page surfaces addons (2026-04-26)

No Electron-shell changes. Rebundles apps/admin only:

- Addons (Cheese Sauce, Garlic Nun, Extra Patty, etc.) now appear
  in the **Admin → Recipes** menu-item dropdown so owner can
  attach a recipe to each. The page was calling `/menu` without
  `includeAddons=true`, so the API was silently filtering addons
  out (same default the website + POS grid use to hide them).
- Without this fix, addon recipes couldn't be authored at all —
  cooked an off-by-stock-deduction bug where every selected addon
  silently skipped its recipe deduction. With recipes wired up,
  selecting an addon at the POS now correctly decrements its
  ingredients via the existing engine in `RecipeService`.

## 0.8.31 — qr-order: parent categories only + scroll arrows (2026-04-26)

No Electron-shell changes. Rebundles apps/qr-order:

- The QR menu pill row now shows **only top-level (parent)
  categories**. Sub-categories no longer appear as their own pills,
  matching the website behaviour.
- Tapping a parent category lists items from the parent **and every
  sub-category beneath it** — previously a parent like "Beverages"
  with only sub-categories (Tea / Coffee / Juices) returned an
  empty grid.
- The pill row gets **chevron buttons + edge fades** when the
  category list overflows the screen width (common on phones with
  6+ categories). Touch swipe still works as before; chevrons hide
  themselves once you've scrolled to that edge.
- The "All" view sections also fold sub-category items under their
  parent so customers see "Beverages → all drinks together"
  instead of three separate sections.

## 0.8.30 — Inventory: "Unused" pill surfaces dead-stock ingredients (2026-04-26)

No Electron-shell changes. Rebundles apps/admin + apps/api:

- New **Unused** pill on Inventory's filter row (next to All / Recipe
  items / Supplies). Shows ingredients that are NOT referenced by
  any menu recipe AND not by any pre-ready recipe — i.e. items the
  branch is paying to stock but never selling.
- **Variant ↔ parent fan-out** done server-side: a recipe linking
  the parent counts every variant as used; a recipe linking a
  specific brand variant counts the parent as used too. So a parent
  whose only usage is via one variant still drops out of the Unused
  list correctly.
- **SUPPLY items excluded** from the Unused view by design — they're
  expected to be non-recipe (tracked via Inventory → Supplies).
- New endpoint `GET /ingredients/usage` returns
  `Record<ingredientId, { menu: number; preReady: number }>`. Pure
  read query — no schema, no migration, no side effects on
  payments / stock / accounts.

## 0.8.29 — website Menu category nav: scroll arrows + edge fade (2026-04-26)

No Electron-shell changes. Rebundles apps/web only:

- The sticky category bar on the customer Menu page (All / Appetizer
  / Sushi / Soup / … / Pizza / …) used to overflow off-screen with
  no affordance — visitors had no way to know there were more tabs
  hidden to the right.
- Now wraps the scroller with **chevron buttons** (left + right) +
  **edge gradient fades**. Buttons appear only when scrolling is
  possible in that direction, so a short tab list still looks
  clean. Click scrolls 70% of the visible width; touch / trackpad
  swipes still work as before.

## 0.8.28 — supplier ledger adjustments (2026-04-26)

No Electron-shell changes. Rebundles apps/admin + apps/api +
@restora/types:

- **New "Ledger Adjustment" action** on the Supplier Ledger dialog
  (Owner/Manager only). Owner picks Reduce / Increase Debt, enters
  an amount + a required reason, and the dialog previews
  `Current Owed → Adjustment → Will Become` before posting. Used
  for fixing wrong opening balances or small reconciliation errors
  without rolling cash through a fake "payment".
- **Pure ledger-only**, by design:
  - Adjusts `Supplier.totalDue` only.
  - Writes a `SupplierAdjustment` audit row with reason + recorded-
    by + timestamp.
  - Does NOT touch any cash/bank Account.
  - Does NOT create an Expense mirror.
  - Does NOT post to Mushak / VAT.
  - Daily Report, work-period close, supplier ageing all read
    SupplierPayment rows — adjustments stay out of cash flow.
- **Supplier ledger view** now shows an "Ledger Adjustments"
  section listing every correction (date, signed amount, reason,
  who recorded it). The running balance sums purchases + payments
  + returns + adjustments live, so the displayed "Owed" figure
  always matches the audit trail.
- **Migration** `20260426100000_add_supplier_adjustment` adds a
  single new `supplier_adjustments` table. Pure additive — existing
  rows untouched.
- **Backup + cleanup audit:** `supplierAdjustment` added to
  `BACKUP_MODELS`; `cleanup.service.ts` `suppliers` and `reset-all`
  scopes drop adjustments before suppliers; DataCleanupPage copy
  updated to mention them.

## 0.8.27 — admin Menu: variants render under their parent (2026-04-26)

No Electron-shell changes. Rebundles apps/admin:

- **Variant rows now nest directly under their parent** in the admin
  Menu list — `Latte (PARENT • 3)` immediately followed by `Latte –
  Single`, `Latte – Double`, etc., instead of being scattered
  alphabetically across the table. Standalone items render first,
  then each parent + its variants, then any orphan variants whose
  parent is filtered out by the search/category. No data change —
  client-side ordering only.

## 0.8.26 — admin sidebar: collapsible groups + quick-jump search (2026-04-25)

No Electron-shell changes. Rebundles apps/admin:

- **Quick-jump search** pinned just under the logo. Press "/"
  anywhere in admin to focus, type a keyword (e.g. "settings",
  "supplies", "mushak"), Enter to jump straight in. Esc clears.
- **Collapsible nav groups** so the sidebar stops growing past the
  fold. The group containing the active route auto-expands; other
  groups stay folded behind a chevron until clicked. Searching
  expands all groups and filters items by label or path.
- **Larger nav text + wider sidebar** (208 → 240 px, font 12 →
  13 px, icons 14 → 15 px) so labels stay legible on retina /
  high-DPI displays without squinting.

## 0.8.25 — non-recipe supplies tracking (2026-04-25)

No Electron-shell changes. Rebundles apps/admin + apps/api +
@restora/types:

- **New SUPPLY ingredient category.** Floor cleaner, parcel bags,
  tissues, plates, bowls, paper straws — anything bought through
  the supplier flow but never used in a recipe — gets tagged as
  SUPPLY. The recipe ingredient picker hides them; the server
  rejects supplies on `/recipes` upsert; daily-consumption stops
  counting them as food cost.
- **Inventory → Supplies pill.** New 3-pill filter row above the
  ingredient table: All / Recipe items / Supplies. Selecting
  Supplies swaps the per-row "Adjust" action to "Record Usage" and
  surfaces a 30-day burn rate + days-of-cover ("Used 240 / 30d ·
  ~22 days left") under each stock cell.
- **Record Usage dialog.** When admin opens the action on a SUPPLY
  row, the Adjust dialog hides the type dropdown, locks to the new
  `OPERATIONAL_USE` movement, and labels the input "Used quantity"
  — enter a positive number; server normalises to a decrement so
  a stray sign can never inflate stock.
- **New Reports → Supplies page.** MTD by default, per-supply rows
  showing purchased qty + spend, used qty, wasted qty, current
  stock, on-hand value, and days-of-cover. Totals card on top,
  grand-totals row at the bottom, Print/PDF + CSV export.
- **Daily Consumption split.** Reports stop folding packaging
  spend into the food-cost margin. The existing
  `/reports/stock/daily` response now carries a separate
  `suppliesItems` + `totalSuppliesUsedValue` so admin's food-cost
  percentage finally reflects food only.
- **Migration** `20260425170000_add_supply_category_and_op_use` is
  pure additive: `ALTER TYPE` adds `SUPPLY` to `IngredientCategory`
  and `OPERATIONAL_USE` to `StockMovementType`. No data backfill,
  existing rows untouched. Owner reclassifies any miscategorised
  CLEANING/PACKAGED rows by hand from Inventory after deploy.

## 0.8.24 — +ADD ticket prints addons + customise lines (2026-04-25)

Hotfix. When a cashier opened **Add Items** on an existing order and
either picked an addon group or used the **🍴 Customise** button to
remove ingredients, the resulting "+ADD" kitchen ticket dropped both
sets of lines:

- The browser-fallback popup template was a custom inline `<table>`
  that printed only quantity + name (no `+ <ADDON>`, no `-- NO <ING>`).
- The desktop ESC/POS branch sent the right fields, but cashiers on
  the web POS — and any KDS-disabled tenants relying on the popup —
  saw a stripped-down ticket so the kitchen never knew about the
  modification.

Both paths now route through the shared `printKitchenTicket` helper
in `@restora/utils`, which already renders `removedIngredients` as
bold `-- NO <NAME>` rows and `selectedAddons` as `+ <NAME>` rows on
both the desktop ESC/POS layout and the browser HTML popup. No
schema or API change.

## 0.8.23 — apply QR addons/notes/customise to qr-order app (2026-04-25)

Hotfix follow-up to 0.8.22. The previous rollout added QR addon
support to `apps/qr/` but production deploys `apps/qr-order/` —
this commit ports the same UX into the customer-facing app.

- **qr-order ItemPage** now renders the addon picker (with min/max
  validation) for any item that has addon groups. Live total
  updates as customer toggles options.
- **qr-order CartPage** uses the new line-key cart store, sends
  `addons` + `notes` to the order DTO, and shows addon picks +
  special notes inline on each cart row.
- **Cart store** (`apps/qr-order/src/store/cart.store.ts`) extends
  CartEntry with `addons` + `notes` and a stable line key so
  different selections become separate rows. Storage key bumped to
  `restora-qr-cart-v2` so any old in-flight carts don't collide.
- **QR self-service ingredient removal** appears as a "Customise
  ingredients" checklist on the item page when admin has the
  branch toggle ON. When OFF, the existing Special Note textarea
  is the only path — cashier reads it on order acceptance and
  applies the removal manually via POS Customise.
- **New public endpoints** powering the QR pickers, both read-only
  and limited-scope:
  - `GET /public/branch/:branchId/settings` — exposes only the
    qrAllowSelfRemoveIngredients toggle (no SMS keys etc).
  - `GET /public/menu/recipe/:menuItemId` — ingredient id + name
    only (no quantities, costs, or supplier info).

## 0.8.22 — table timers + QR addons/variants + self-remove toggle (2026-04-25)

Rebundles apps/pos + apps/qr + @restora/types:

- **POS Tables — per-table phase clock.** Each occupied table card
  now shows the live status timer: "Order Placed → 30:04",
  "Food Preparing → 14:04", "Food Served → 35:33". Card turns amber
  at 80% of the threshold and red+pulsing past 100%. Three phases,
  each clock starts fresh from the previous transition (server
  captures `firstKitchenStartAt` + `firstKitchenDoneAt` on the order
  the very first time KDS Start / Done fires; idempotent on re-click).
- **Admin Settings → Kitchen → Table Timers.** Three numeric inputs
  (minutes) for the three phase thresholds; defaults 30 / 40 / 35.
- **QR app supports variants + addons.** When a QR-app customer taps
  a menu item with addon groups, an addon picker opens (same
  min/max validation as POS). Cart-line key extends to include
  addon picks so different combos are separate rows. Variants flow
  through as standalone items (each variant is its own pickable
  card with its own price + recipe — same as POS).
- **QR self-service ingredient removal — admin toggle.** Off by
  default. When OFF, the QR app shows only the existing Special
  Note field — cashier reads the note in the pending-order view
  and applies the removal manually via the POS Customise dialog.
  Server strips any `removedIngredientIds` sent from QR when the
  toggle is OFF, so a malicious client can't bypass.
- **Live-safety.** Pure additive nullable schema columns. Existing
  rows behave identically until the new columns get values.

## 0.8.21 — addons / modifiers (Phase 3) (2026-04-25)

Rebundles apps/pos + apps/pos-desktop main + @restora/types + @restora/utils:

- **Addons / modifiers.** A menu item flagged `isAddon=true` (Extra
  Patty, Cheese Sauce, Garlic Nun) becomes selectable only via an
  Addon Group attached to a parent menu item. Each addon is a real
  MenuItem with its own price + recipe — same engines compute COGS,
  same engines deduct stock.
- **Addon Groups** with `minPicks` / `maxPicks`. Required groups
  (min ≥ 1) block the picker's Save button until satisfied. Optional
  groups (min = 0) let the cashier skip ("no sauce"). Multiple
  groups per menu item are supported (Steak: pick 0–2 sides + pick
  0–1 sauce).
- **POS picker** opens automatically when the cashier taps a parent
  with addon groups (after the variant chooser if applicable). Live
  total = base + addons. Cart-line key now includes addon picks so
  each unique combination is its own row + KT entry.
- **Recipe deduction** runs on every selected addon's recipe in
  addition to the base item's. Empty addon recipe = no deduction
  (admin sees a warning when saving the group: "These addons have
  no recipe — selecting them won't deduct any stock").
- **KT print** prepends `+ Cheese Sauce` rows under each modified
  item; admin Receipt + Mushak slip itemize each addon for VAT.
- **Admin Menu page** gets a new `+A` action button per parent item
  → opens the Addon Groups editor (create / edit / delete groups,
  pick which addon items belong to each, set min/max). New "Treat
  as addon" toggle on the item edit dialog hides the row from the
  main grid + the website / QR feed.
- **Backups + cleanup audit.** Two new tables added to
  `BACKUP_MODELS` (`menu_item_addon_groups`, `menu_item_addon_options`).
  Cleanup `menu-items` + `menu-all` scopes auto-cascade via
  `onDelete: Cascade` FKs; DataCleanupPage copy updated.
- **Live-safety.** Pure additive schema. Existing rows behave
  identically until admin attaches an addon group.

## 0.8.20 — per-order ingredient removal (Phase 2) (2026-04-25)

Rebundles apps/pos + apps/pos-desktop main + @restora/types + @restora/utils:

- **"No garlic" mods.** Cashier opens a Customise button on any
  cart line → ticks the ingredients to remove → save. The cart
  line auto-splits when mods differ — 4× chicken (2× without
  garlic + 2× normal) lands as two cart rows / two KT entries.
- **Stock deduction respects mods.** Removed ingredients are
  skipped during the recipe deduction, so a "no garlic" line
  doesn't pull garlic stock for that line.
- **KT print** prepends a bold `— NO <NAME>` line under each
  modified item. Works on both the Electron thermal-printer path
  (apps/pos-desktop ESC/POS) and the browser HTML fallback.
- **Snapshot semantics.** Removed ingredient names are frozen on
  the OrderItem at order time, so a future ingredient rename
  doesn't rewrite history. Reports keep grouping by menuItemId
  (mods are display-only).
- **Live-safety.** Pure additive nullable JSON column. Existing
  OrderItem rows have `modifications=null` and behave identically.
- New cashier-readable endpoint
  `GET /cashier-ops/recipes/menu-item/:id` powers the Customise
  picker without exposing the admin-only `/recipes` route.
- Phase 3 (addons / modifiers) ships next.

## 0.8.19 — menu variants (Phase 1 of variants/mods/addons) (2026-04-25)

No Electron-shell changes. Rebundles apps/pos + @restora/types:

- **Menu variants.** A menu item can now act as a "picker shell"
  that groups several sellable variants — each variant is a real
  MenuItem with its own price + recipe. Example: one shell "Dim
  Sum Hargao" → "Prawn ৳450" (prawn recipe) + "Chicken ৳350"
  (chicken recipe). Cashier taps the shell in POS → variant chooser
  opens → picks one → it lands in the cart at the variant's price
  and deducts the variant's recipe.
- **Admin Menu page** gets a "Has Variants" toggle on the edit
  dialog. When enabled, the Price field is hidden (variants carry
  the price). A "Parent" dropdown on standalone items lets you
  attach them as variants of an existing parent. List view badges
  parents with `PARENT • N` and indents children with `└`.
- **Reports unchanged.** Variants are first-class MenuItem rows so
  Items Sold, Performance, Mushak, etc. all keep working — each
  variant shows up as its own row (Hargao Prawn separate from
  Hargao Chicken), which is what we want for distinct prices and
  costs.
- **Live-safety.** Pure additive schema (`variantParentId` nullable
  + `isVariantParent` defaults false). Existing menu items behave
  identically until admin opts in. Variants are limited to one
  level deep — a parent cannot itself be a variant.
- Phases 2 (per-order ingredient removal) and 3 (addons / modifiers)
  ship in follow-up rollouts.

## 0.8.18 — performance report + POS Customised Menu (2026-04-25)

No Electron-shell changes. Rebundles apps/pos + @restora/types:

- **Performance Report** (admin → Reports → Performance): per-menu-item
  qty / revenue / COGS / gross profit / margin% over a date range, with
  a category roll-up and an inventory price-volatility panel that
  highlights ingredients whose unit cost has shifted across deliveries.
  Header surfaces an average margin baseline that can be one-click
  applied as the Custom Menu cost-margin in Settings.
- **POS Customised Menu**: cashier (gated by the new `createCustomMenu`
  Cashier Permission) can build a one-off dish — name, optional
  description, recipe assembled by copying lines from any existing menu
  or pre-ready recipe (multi-source, duplicate ingredients auto-merge
  by summing quantity). Server validates the selling price against the
  branch's three margin policies (cost, negotiate, max) and creates a
  hidden MenuItem in an auto-managed "Custom Orders" category so it
  rides the existing recipe → stock-deduction pipeline. The new item
  appears in the cart immediately and shows up in every report without
  polluting the website / admin Menu page.
- **Branch margin policy** (Settings → Kitchen → Custom Menu Pricing):
  three new fields — Cost Margin %, Negotiate Margin %, Max Margin %.
  All three default to "no enforced floor / ceiling" so legacy installs
  behave identically until admin opts in.

## 0.8.17 — pre-ready cost-per-unit + auto inventory mirror (2026-04-25)

No Electron-shell changes. Rebundles apps/pos + @restora/types:

- **Pre-ready items now carry a cached cost-per-unit** derived from the
  recipe (sum of ingredient cost × deduct qty / yield, with unit
  conversions and variant-fallback). Refreshed automatically when the
  recipe is saved or a production completes, and surfaced as a Cost
  column in the POS Pre-Ready list and the admin items table.
- **Recalculate Costs button** (per-row + bulk on the admin Pre-Ready
  page) refreshes the cached cost on demand, so admins can re-price
  after ingredient costs change without running a fresh production.
- **Auto-mirror to inventory on create.** Creating a pre-ready item
  immediately creates a matching `[PR] <name>` ingredient row (cost 0
  until the recipe is wired). Menu recipes can reference pre-ready
  foods from day one — no waiting for a first production run.

## 0.8.16 — payment correction + items-sold report (2026-04-25)

No Electron-shell changes. Rebundles apps/pos + @restora/types:

- **Correct payment method on a paid order.** When a cashier taps the
  wrong tender (e.g. CASH instead of bKash, or POS Card instead of
  Cash), Owner / Manager can fix it from the Sales Report. The fix
  reverses the original SALE postings against the linked accounts
  (recorded as ADJUSTMENT in the ledger), rewrites the OrderPayment
  rows, refreshes the Mushak-6.3 paymentSummary in-place (totals and
  items remain frozen), and re-credits the corrected method. Work-
  period reconciliation auto-corrects because it reads OrderPayment
  rows live. Single + split layouts both supported; approver PIN is
  optional but verified when supplied.
- **Items Sold report.** New POS tab on the Sales Report (today
  only) listing every paid line aggregated by item + unit price as
  "qty × name × unit = total" with a grand total. Admin gets the
  same view at /reports/items with a date-range filter and Print /
  PDF export.

## 0.8.15 — receive: discount + extra fees (2026-04-25)

No Electron-shell changes. Rebundles apps/pos + @restora/types:

- **Receipt-level adjustments at delivery.** Cashier can now record
  a flat supplier-offered discount (with optional reason) and any
  number of extra fees (delivery, labour, packaging) when receiving
  goods. The supplier ledger settles to items + extra fees − discount
  so the running balance reflects the actual billed amount.
- **POS receive form** gets a Receipt Adjustments block with a
  Discount field, optional reason, and a dynamic Add Fee list.
  Grand-total breakdown shows items + extras / + extra fees /
  − discount / Net.

## 0.8.14 — admin-configurable custom roles (2026-04-25)

No Electron-shell changes. Rebundles apps/pos + @restora/types:

- **Custom roles.** Admin can now create branch-scoped roles (e.g.
  "Head Chef", "Shift Supervisor", "Floor Lead") that overlay the
  built-in six. Each custom role inherits a base role (the security
  anchor — JWT + @Roles() checks still run against it) and can
  (a) HIDE admin navigation items the base role would see, and
  (b) tighten the POS cashier-ops matrix per role. Custom roles can
  NEVER elevate beyond the base role. New "Custom Roles" sidebar
  entry under system config; StaffPage gets a "Custom Role (optional
  overlay)" dropdown.
- The POS `/cashier-permissions` endpoint now returns the caller-
  specific effective matrix (branch default merged with the staff's
  custom-role overrides), so cashier buttons match the role.

## 0.8.13 — auto round-to-taka + Mushak display fix (2026-04-23)

No Electron-shell changes. Rebundles apps/pos + @restora/utils:

- **Bills auto-round to the nearest taka.** ৳973.70 → ৳974.00 with
  an "Auto Roundup (+0.30)" line printed above the grand total.
  ৳973.20 → ৳973.00 with "-0.20". Works across thermal ESC/POS,
  HTML print fallback, POS Receipt + Bill modals, and Mushak 6.3
  slips. Stored as Order.roundAdjustment (signed paisa).
- **Mushak register + slip no longer show ×100 amounts.** A ৳6184.50
  bill printed as 618450.00 because the slip / register rendered
  paisa directly; now divides by 100 at the display layer. CSV
  export converts to taka so accountants' sums match the receipt.

## 0.8.12 — NBR Mushak (Bangladesh VAT) (2026-04-23)

No Electron-shell changes. Rebundles apps/pos + @restora/utils:

- **Mushak-6.3 invoices on every paid order** when the branch toggles
  NBR mode on. Atomic per-branch, per-fiscal-year serials in the form
  `2526/DHK/000147`. A frozen JSON snapshot is archived so re-prints
  stay legally stable even after menu prices / VAT rates change.
- **Mushak-6.8 credit notes on refund.** A new Refund button on
  paid orders in the POS opens a full / per-item refund dialog with
  reason codes and approver password. The 6.8 slip auto-prints after
  issuance, the account balance is reversed, and stock is restored.
- **Admin Mushak Register** (9.1 equivalent): month picker, CSV
  export, HTML print, filter invoices vs credit notes.
- **Admin Print-6.3** button on every paid row in the Sales Report.
- Branch form now has a dedicated "NBR / Mushak Compliance" block
  with nbrEnabled toggle + BIN + branchCode + seller legal/trading.
- Non-Bangladesh deployments unaffected — everything is gated on
  `branch.nbrEnabled=false` by default.

## 0.8.11 — desktop KDS socket fix (2026-04-23)

No Electron-shell changes. Rebundles apps/pos:

- **KDS Start / Done now work inside the desktop POS.** The embedded
  KitchenPage used to open a socket with a relative '/ws' path that
  resolved against the Electron renderer origin (not the paired API
  server), so Start and Done clicks emitted to nowhere. The socket
  now asks the main process for the paired serverUrl at connect
  time and targets the API host directly.

## 0.8.10 — KOT rework + waiter pool opened (2026-04-23)

No Electron-shell changes. Rebundles apps/pos + @restora/utils:

- **Any non-kitchen staff can be set as waiter on an order.** The
  POS waiter dropdown + Tables-page "Set Waiter" modal now include
  every active staff member except `role=KITCHEN`. Covers the
  common case where a cashier or manager serves a table directly.
- **Kitchen ticket (KOT) print rebuilt for legibility.** Table
  destination at 2x (32px HTML / double-size ESC/POS), every item
  row at ~2x bold with a double-line separator between rows, so
  cooks can read the ticket across the pass. Section label +
  "New Order" + date/time stay at normal size at the top.

## 0.8.9 — purchasing accuracy + SMS backup coverage (2026-04-23)

No Electron-shell changes. Rebundles apps/pos + @restora/utils:

- **Variant pack size in PO + receive + ledger rows.** Variants now
  render as `Parent — Brand (PackSize)` across purchasing, receive,
  return, and supplier-ledger screens via the new shared
  `ingredientDisplayName` helper.
- **PO line + grand total use received qty on over-delivery.** When
  a supplier ships more than the PO ordered, totals now multiply
  unitCost × received instead of × ordered — matching the print
  export and supplier ledger.
- **Variant cost/unit auto-derivation.** createVariant + update +
  bulk CSV import derive `costPerUnit` from `costPerPurchaseUnit /
  purchaseUnitQty`, so the inventory Cost/Unit column and daily
  consumption value are correct for variants. One-shot repair
  endpoint + UI button backfills existing rows.
- **Reconciliation double-count fix.** Supplier + payroll payouts
  auto-create mirror Expense rows; the balance builder now filters
  them so the admin Daily Report Expected column matches the POS
  close-day live balance.
- **Auto-link supplier on PO + receive.** Pairing an ingredient with
  a supplier upserts the IngredientSupplier row and, if the ingredient
  had no primary supplier, promotes this one — shopping list
  pre-fills the supplier next order.
- **Backup + cleanup cover sms_logs + sms_templates.** SMS history +
  template catalog now round-trip through backup/restore; a dedicated
  "Delete all SMS logs" cleanup scope keeps templates intact.

No Electron main-process changes.

## 0.8.8 — advisor/waiter POS access + UI polish (2026-04-23)

No Electron-shell changes. Rebundles apps/pos + @restora/utils:

- **ADVISOR + WAITER get cashier-tier POS access** across the POS
  operations matrix. Start-Day, Create-PO, Receive, Expenses, etc.
  all run through the same per-action policy cashiers use.
- **Advisor Start-Day** fixed — `/accounts` read widened so the
  opening-cash picker populates.
- **Wider admin purchasing form** (max-w-3xl → max-w-6xl) so the
  ingredient cell doesn't clip long variant labels.
- **Add/Edit Ingredient dialog** sticky header + footer, scrollable
  body — Save button always reachable.
- **Backup accessor guard** — backups survive a stale Prisma client
  with a warning instead of crashing.

## 0.8.7 — embedded POS refresh (2026-04-23)

No Electron-shell changes. Rebundles apps/pos + @restora/utils so
terminals pick up the latest fixes from main:

- **Canonical variant label** on the POS Create-PO search + datalist
  now reads `Parent — Brand Pack UNIT (PurchaseUnit) (extended)` via
  `formatVariantLabel` — variants stop rendering as short "Name (Unit)"
  strings and are uniquely identifiable end-to-end.
- **Parent-unit cascade** — flipping a parent ingredient's unit
  (G → PCS etc.) now updates every variant in one DB call so the
  line on the POS receive/purchasing screen matches the parent.
- **Variant delete** at the admin inventory row when the variant's
  stock is 0; parent's aggregate stock is resynced after the delete.
- **Wider ingredient column** on POS receive-goods list.

## 0.8.6 — embedded POS refresh (2026-04-22)

No Electron-shell changes. This release rebundles the embedded web POS
(`apps/pos`) + shared utilities so terminals pick up everything that's
landed on main since the 0.8.5 tag:

- **Per-user `canAccessPos` gate.** Staff members flipped off in admin
  no longer appear on the lock screen (server-side filter). Existing
  PINs rejected with "POS access has been disabled for this account"
  on both pin-login and password-login paths.
- **Canonical variant label** everywhere that shows an ingredient:
  purchasing receive rows, shopping list, stock adjustments. Format
  is `Parent — Brand Pack UNIT (PurchaseUnit) (extended)` via the new
  `formatVariantLabel` helper in `@restora/utils`.
- **Wider ingredient column** on POS purchasing receive list (matches
  the admin-side widening). Tooltip on hover for any label that still
  clips.
- **Auto-generated SKU / itemCode** when the admin leaves them blank
  — every variant becomes targetable in the Stock Update CSV.
- Misc carry-alongs from main: ADVISOR role support in the session
  bridge, shopping-list print coverage for unassigned suppliers,
  staff-password update fix (no more raw-password Prisma crash).

## 0.6.0 — installer + auto-update (2026-04-15)

- **`pnpm dist` now produces a working Windows installer.** `release/RestoraPOS-Setup-{version}.exe` (~90 MB NSIS), along with `latest.yml` and `.blockmap` for auto-update.
- **electron-updater integrated** — the main process checks GitHub releases 15 s after launch, then every 6 h. `UpdateToast` surfaces Checking / Available / Downloading / Ready / Error states as a bottom-left pill. "Restart now" button installs + relaunches.
- **Desktop menu** now shows the app version and a **Check for updates** button.
- **Release workflow enabled**: tag with `pos-desktop-v*` and push → GitHub Actions builds on `windows-latest` and publishes the installer + manifest to that tag's release.
- **electron-builder.yml hardened** for pnpm workspaces: workspace-linked packages (`@restora/types`, `@restora/utils`) are moved to `devDependencies` and bundled into the main/preload output by Vite, sidestepping electron-builder's "must be under app dir" error.
- **Uninstaller preserves config**: `deleteAppDataOnUninstall: false` keeps paired device tokens + cashier PINs through version upgrades.
- **Logs**: `electron-log` wired up; updater events land in the app's user-data log file for field debugging.

## 0.5.0 — web POS embedded (2026-04-15)

- **The real cashier UI is now in the desktop app.** `apps/pos/src/App` is imported directly — every page, layout, component, theme, and Tailwind class pulls from the web POS verbatim. No forks, no duplicate code.
- **Global fetch shim** transparently routes every `/api/v1/**` request through `window.desktop.api.fetch`, which flows into the online/outbox/idempotency pipeline built in Phase 4. POS code is unchanged.
- **Auth bridge**: after a cashier signs in via the desktop PIN flow, `apps/pos`'s zustand store is seeded with the SessionUser. POS renders directly into its main UI — no LoginPage flash.
- **MemoryRouter** wraps the embedded POS so navigation is in-app only; the Electron window's URL isn't touched.
- **Sign-out bounce**: if POS signs itself out (401 cascade etc.), desktop catches the state change and bounces back to the lock screen — cashiers never see POS's own email/password login form.
- **Desktop overlay chrome**: a floating bottom-right ⋮ menu offers Sync Status, Printer Settings, and Sign Out without modifying POS sidebar/layout code.
- **Tailwind** wired: desktop's config extends `apps/pos/tailwind.config.js` and scans both trees so every utility class works.
- Bundle size: renderer now ships at ~900 KB (React Query, router, icons, POS pages, Tailwind). Acceptable; splitting can be addressed in Phase 7.
- **KitchenPage** is imported but its socket.io `/ws` connection won't resolve in a packaged build — it's out-of-scope for cashier terminals. A follow-up can wire it to the paired server URL.

## 0.4.0 — offline outbox + idempotent sync (2026-04-15)

- **Online detector**: pings `/health` every 15 s (3 s when offline). Emits status changes to every renderer.
- **SQLite outbox** (`outbox` table): persists mutations that couldn't reach the server. Each row carries its own Idempotency-Key so retries are safe.
- **Fetch proxy** (`window.desktop.api.fetch`): every request flows through the main process. Attaches session token + idempotency key; on offline mutation the row is queued and a synthetic `202 queued` response is returned to the renderer.
- **Sync worker**: drains pending rows FIFO on every offline → online transition. 5xx/network errors keep the row pending (exponential retry); 4xx marks it `failed` and surfaces in Sync Issues.
- **Backend `IdempotencyRecord`**: new Prisma model + global interceptor. Any mutation with an `Idempotency-Key` header returns the cached response on replay. 24 h TTL.
- **SyncBanner**: top-of-window strip showing OFFLINE / SYNC ISSUES / SYNCING state with pending + failed counts.
- **SyncPanel**: admin screen with Probe, Drain, Force Offline (test mode), a demo harness, and a failed-request table with inline Retry / Dismiss buttons.
- **New virtual thermal printer** script (`pnpm --filter @restora/pos-desktop virtual-printer`) that annotates ESC/POS traffic — drawer kick and paper cut are called out explicitly.

## 0.3.0 — printer plumbing + cash drawer (2026-04-15)

- **Three printer slots**: Kitchen KOT (80 mm), Bill/Receipt (80 mm), Reports (A4). Each configurable independently.
- **Two modes** per thermal slot: `network` (ESC/POS over TCP port 9100 via `node-thermal-printer`) and `os-printer` (HTML through Chromium to any Windows-installed printer). Reports is OS-printer only.
- **Cash drawer kick**: appended to the same ESC/POS job as the receipt on cash payments. Requires bill printer in network mode. Togglable.
- **PrinterSettings UI**: full-screen config page with per-slot mode picker, host:port inputs, OS printer dropdown (populated via Chromium's `getPrintersAsync()`), and a Test Print button for each slot.
- Sample Test Prints: realistic kitchen ticket, receipt with totals + drawer kick, and A4 sales-summary layout — so cashiers can verify paper, character set, and drawer wiring.
- IPC surface: `window.desktop.printers.{listOs, get, set, test, openCashDrawer}` + `window.desktop.print.{kitchen, receipt, reportA4}` — ready for Phase 5 to consume from the real POS flow.
- Printer config lives inside the DPAPI-encrypted config blob at `%APPDATA%/Restora POS/config.enc`.

## 0.2.0 — cashier lock screen + PIN auth (2026-04-15)

- **Lock screen**: grid of cashier tiles (auto-populated from paired branch). Each tile shows initials, name, role, and a "Set PIN" badge for first-time users.
- **PIN pad**: 4–6 digit PIN entry with 12-key numeric pad, auto-submit prompt, dot-masked display. Lockout after 3 wrong attempts (30 s) and 8 attempts (5 min).
- **First-time setup**: cashier enters password once → proves identity against the server → picks a 4–6 digit PIN stored locally as a bcrypt hash. Never repeats on this terminal.
- **Local SQLite** (`better-sqlite3`) at `%APPDATA%/Restora POS/local.db` — schema: `cashier_pins`, `cashiers` cache. Migrations run on app start.
- **In-memory session holder** in main process keeps access/refresh tokens; never exposed to renderer. Tokens do not persist across restarts by design.
- Backend: new `POST /devices/cashiers` endpoint (auth via device token) so terminals refresh their lock-screen list when online. `POST /devices/register` response also primes the cache.
- IPC surface: `window.desktop.cashier.{list, pinStatus, verifyPin, setPin}` + `window.desktop.session.{current, signout}`.

## 0.1.0 — device pairing (2026-04-15)

- **First-Run Setup screen**: owner enters server URL, credentials, branch id, terminal name.
- **DPAPI-encrypted config store** at `%APPDATA%/Restora POS/config.enc`. Device token never crosses the IPC bridge.
- Backend: new `Device` Prisma model + `POST /devices/register`, `GET/DELETE/PATCH /devices` admin endpoints.
- Backend: new auth routes `POST /auth/pin-login` and `POST /auth/password-login-on-device` (Phase 2 will consume them).
- Admin: **Terminals** page lists paired devices with online/offline badges and revoke action.
- IPC surface: `window.desktop.config.*` and `window.desktop.device.*`.

## 0.0.0 — scaffolding (2026-04-15)

- New workspace `apps/pos-desktop/` with `electron-vite` build pipeline.
- Blank Electron window + React placeholder screen.
- `contextBridge` stub exposing `window.desktop = { version, phase }`.
- `electron-builder.yml` configured for Windows NSIS output.
- CI workflow committed but trigger disabled until real features land.
- `CLAUDE.md` documenting architectural invariants.

No user-facing functionality. No hardware, no auth, no IPC, no offline logic.
