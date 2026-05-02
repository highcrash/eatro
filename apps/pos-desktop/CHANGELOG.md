# Changelog — Your Restaurant POS Desktop

All notable changes to the desktop cashier app are documented here.
Versioning follows SemVer. Tags are `pos-desktop-v{version}`.

## 1.0.52 — POS: Recent custom menus picker + edit-as-new (2026-05-02)

POS + API rebundle. No Electron-shell changes.

- Custom Menu dialog now shows a "Recent (N)" button when there
  are custom items built on this branch in the last 30 days.
- Recent picker offers two actions per row: "Add" reuses the
  exact same MenuItem in the cart (no duplicate row created),
  or "Edit & Save New" prefills the form with the prior recipe
  + price + name (suffixed " (copy)") so the cashier can tweak
  ingredients and save as a fresh custom item.

## 1.0.51 — Admin: Custom Menu audit + promote-to-regular flow (2026-05-02)

Admin + API rebundle. No Electron-shell changes.

- New "Custom Menu" page under RESTAURANT in the admin sidebar.
  Lists every POS-built custom item with name, price, COGS,
  margin %, sold count, lifetime revenue, and last-sold date.
  Click a row to expand its recipe (ingredient, qty per
  serving, stock-unit cost) for audit.
- Per-row "Save to Menu" promotes the custom dish to a regular
  menu item the cashier can re-order from the standard picker.
  Owner picks a real category, optionally renames, optionally
  toggles website visibility (defaults to visible). Recipe and
  price are preserved as-is.
- API: GET /menu/custom-items + POST /menu/:id/promote, both
  OWNER/MANAGER/ADVISOR. Stats join through OrderItem and
  exclude voided/refunded so audit numbers match the sales
  reports.

## 1.0.50 — POS: bKash/MFS expenses now post to the linked account (2026-05-02)

Renderer-only rebundle. No Electron-shell changes.

- Cashier-recorded expenses paid via bKash (and any non-CASH
  method) were silently skipping the account ledger, so the
  bKash account statement showed nothing even though the
  expense was created. The Finance form's payment-method
  dropdown was hard-coded to legacy enum values that didn't
  match the configured PaymentOption.codes; replaced it with a
  /payment-methods-fed selector (same source the order
  PaymentModal uses), so the cashier picks the actual
  configured tender and the API gets a code it can resolve.
- API-side hardening: when a PaymentOption resolves but
  carries no accountId of its own, the resolver now climbs to
  the option's PaymentMethodConfig and reuses the category's
  default-option accountId or the legacy
  linkedPaymentMethod=<categoryCode> account. Closes the
  silent-skip path for legacy installs.

## 1.0.49 — POS: cart subtotal honours active menu-item discounts (2026-05-01)

Renderer-only rebundle. No Electron-shell changes.

- Cart line subtotals and the running cart total now use the
  server-stamped discountedPrice when a MenuItemDiscount is active,
  matching what the order pricer charges on submit. Previously the
  menu tile showed the discount with a strikethrough but the cart
  itself charged the un-discounted figure, so the cashier-visible
  total drifted from the actual checkout total.
- Fix lands at all four sites: new-order subtotal + line display
  and the add-items overlay's subtotal + line display.

## 1.0.48 — Lock screen: Forgot PIN? Reset with password (2026-05-01)

Renderer-only change. Reuses the existing setPin IPC.

- New "Forgot PIN? Reset with password" link on the PIN pad.
  Tapping it routes the cashier to the same form first-time
  cashiers use (verify Your Restaurant password, then pick a new
  4–6 digit PIN). The setPin IPC handler validates the password
  against the API via passwordLoginOnDevice and overwrites the
  local bcrypt PIN hash on success.
- Form copy switches between "Set PIN" (first-time) and "Reset
  PIN" (forgot) so the cashier knows whether they're choosing a
  fresh PIN or replacing an existing one.
- No new IPC, no new server endpoint — same auth path the device
  already uses for first-time PIN setup. Lockout state is cleared
  by the underlying setPin upsert.

## 1.0.47 — POS: discount price on tiles + auto-FB-post caption editor (2026-05-01)

No Electron-shell changes. Rebundles apps/pos + apps/admin + apps/api:

- POS menu tiles now render the discounted price in accent colour
  with the original price strikethrough'd next to it. The /menu
  endpoint that POS hits never carried discount data — the public
  website applied discounts but POS didn't, so cashiers saw the
  full price even when the order pricing engine WAS already
  applying the discount on submit. Customers got the discount;
  cashiers were just blind to it on the tile.
- Auto-Facebook-post: admin can now edit the caption template per
  branch (Settings → Marketing → Post Caption Template). Live
  preview of {PLACEHOLDER} chips, monospace textarea, Reset to
  Default. Custom template stored on BranchSetting; null reverts
  to the system default.
- Designer-feedback round on the discount image: PRICE DROP /
  EVERY headline now sized at 140px (was 180, was reading as
  stretched), VALID + day list switched to Perandory Condensed,
  food image bumped to 760px, OFF badge value scales by string
  length (BDT 30 fits the splat now), address footer in clean
  Perandory Condensed all-caps.

## 1.0.46 — POS: cash-account transfers now reconcile correctly (2026-05-01)

No Electron-shell changes. Rebundles apps/pos only:

- The Balance Reconciliation table on the End-of-Day report was
  off by every inter-account transfer (cash → bKash etc.) — the
  expected balance ignored transfer-in / transfer-out, so cashiers
  saw bogus discrepancies even when actual closing cash matched.
  The expected formula now picks up a per-account signed net
  transfer term, and a new ±Transfer column on both the screen
  and printed Z-report shows the move. Reviews tile on website
  also fixed (was reading old rating/comment fields).

## 1.0.45 — POS: Mushak Register Serial # + SD column on Sales Report (2026-05-01)

No Electron-shell changes. Rebundles apps/pos only:

- POS Sales Report (Today + Date Range) now renders like the
  Mushak Register: the throwaway short-code "Ref" column is
  replaced with "Mushak Serial #", showing the legal serial from
  each order's MushakInvoice row. Clicking the serial reprints the
  6.3 invoice slip in a popup (same path RefundOrderDialog uses
  for 6.8 credit notes). Orders without a Mushak invoice fall back
  to the old short-code, greyed out.
- Items column dropped — auditor view only needs amounts.
- New SD (Supplementary Duty) column between Discount and VAT;
  pulls MushakInvoice.sdAmount. Grand-total row sums it.
- Bundled along the way: custom-menu COGS now applies unit
  conversion (recipe-line "Salt 6 G" against KG-stocked
  ingredient no longer reports 1/1000th of the real cost). Same
  fix lands in the Performance Report's per-item COGS column.

## 1.0.44 — POS: print KOT when approving customer-added items (2026-04-30)

No Electron-shell changes. Rebundles apps/pos only:

- When a customer adds items to a confirmed order from QR, the
  cashier sees a "NEW ITEMS" badge and approves them. Approve
  flipped the items from PENDING_APPROVAL to NEW so the kitchen
  could see them, but never invoked the printer — chefs had to
  read items off the screen, which broke station-by-station
  routing. Now both Approve and Approve-All print a KOT with
  ONLY the newly-approved items (already-cooking items aren't
  reprinted).

## 1.0.43 — POS: recover hidden orders when a table has more than one (2026-04-30)

No Electron-shell changes. Rebundles apps/pos only:

- When two QR orders ended up on the same table the cashier
  could only ever see the newest one — Order A still existed
  in the DB but the table view silently picked Order B and
  left A unreachable. Three new affordances close the gap:
  a TableOrderPicker on OrderPage when a table has >1 active
  order; a "+N more" badge on tables in the grid; and a
  branch-wide Open Orders modal accessible from the Tables
  header. From any of them the cashier can jump straight to
  any active order to continue, take payment, or void.

## 1.0.42 — POS: print KOT when cashier accepts a QR order (2026-04-30)

No Electron-shell changes. Rebundles apps/pos only:

- Regular POS orders auto-printed the kitchen ticket on placement,
  but QR orders silently never printed because the cashier-accept
  mutation didn't trigger the print path. Cashiers were having to
  re-print manually for every QR order. The accept handler in
  ActiveOrderView now invokes the same kitchen-ticket helper the
  create-order flow uses, no-op'ing when the branch has KDS turned
  on (the screen handles it instead).

Bundled along the way (no behavior change to the desktop shell):

- /menu-print: A4 printable menu page on the website with light/
  dark toggle, per-page category title repetition, variant + addon
  rendering, ingredient pills capped at 2 lines.
- Inventory: stock movements now server-paginated (full history
  searchable; default 200 rows/page, max 500).
- Tipsoi attendance: shiftDate now stored as UTC-midnight matching
  the branch-local calendar date so the date column doesn't drift
  one day behind on UTC servers.
- Supplier receive flow: receipt-level extra fees (delivery,
  freight) write their own Expense rows at receive time, supplier
  ledger UI breaks down items / fees / discount / net payable.
- QR-order: cross-device active-order rescan, editable per-item
  notes while still PENDING, "Ask for Bill" button, optional
  "Review your order" page (login required).

## 1.0.41 — POS: edit customer name/phone/email (2026-04-28)

No Electron-shell changes. Rebundles apps/pos only:

- Cashier can now edit a customer's name, phone, or email
  inline from the POS Customers page — pencil button on the
  detail panel header opens a small modal with the same three
  fields used by the Add dialog.
- Phone collisions inside the same branch surface as a
  friendly inline error ("Another customer in this branch
  already uses 0171…"), not a generic 500.
- Delete is intentionally admin-only (admin panel) — POS
  doesn't get the destructive op. Cashiers manage typos +
  contact updates without leaving POS.
- api-proxy hardening: PATCH and DELETE on /customers/:id are
  now in the offlineUnsupported list — they need server-side
  validation (phone uniqueness, FK guard on delete), so we
  reject with a clean OFFLINE_UNSUPPORTED instead of queuing
  the mutation to fail later.

## 1.0.40 — website: carousel cards show variant price (no more ৳0) (2026-04-27)

No Electron-shell changes. Rebundles apps/web only:

- Variant parent shells (e.g. "Iced Mocha", "Latte") were
  rendering as `BDT 0.00` on the homepage category carousels
  because the parent itself carries no price — variants do.
- The MenuCarousel now falls back to the cheapest variant's
  price with a "From" prefix (matches the parent-card behaviour
  shipped in v1.0.38). HomePage's PublicMenu interface was
  extended to pass `isVariantParent` + `variants` through to
  the carousel so the fallback engages.
- Pure UI fix — no API change. Standalone items render
  unchanged.

## 1.0.39 — website: Available Add-ons section on item detail (2026-04-27)

No Electron-shell changes. Rebundles apps/web only:

- Adds an **Available Add-ons** section to the customer item
  detail page, between Key Ingredients and the Pieces / Prep
  Time / Spice Level info cards. Each addon group shows its
  name + min/max requirement ("Pick 2", "Optional · up to 1")
  with chips for every option underneath ("Cheese Sauce
  +৳50", "Bacon +৳80"). Informational only — ordering still
  happens via QR / POS where the picker enforces the rules.
- For variant parents the addon groups attached to the parent
  shell flow through to every variant tab (the common admin
  pattern: attach addons once on the shell). If admin
  attaches per-variant addons, those override the parent's
  for that variant.
- API select already exposes addonGroups with their options +
  hydrated addon detail, so this is a pure UI addition — no
  schema, no migration, no payload change.

## 1.0.38 — website: parent-only menu cards + variant tabs on detail (2026-04-27)

No Electron-shell changes. Rebundles apps/web + apps/api:

- **Menu grid hides individual variants.** The customer site
  used to render every variant of a parent (e.g. Hargao Prawn
  + Hargao Chicken) as separate cards. Now only the parent
  shell + standalones appear in the grid; variants surface as
  tabs on the parent's detail page.
- **Variant tiles on the parent card.** When a card is a
  parent, it shows a tile strip beneath the price with each
  variant's name + price differential vs the cheapest
  ("Single ৳350 · Double +৳100 · Triple +৳200"). Cap at 4
  visible tiles with "+N more" tail. The card price reads
  "From ৳350" so customers know the spread starts there.
- **Variant tabs on the detail page.** Opening a parent shows
  a tab strip directly under the name. Clicking a tab swaps
  the hero image, description, price (with discount handling),
  tags, key ingredients, and pieces / prep time / spice level
  info cards in place. Defaults to the cheapest variant on
  load. Standalone items render unchanged.
- **API:** `PUBLIC_MENU_ITEM_SELECT` now exposes
  `isVariantParent`, `variantParentId`, and a lightweight
  `variants[]` array (id, name, price, image, pieces, etc.)
  on each menu payload. The `getMenu` filter flips from
  `isVariantParent: false` to `variantParentId: null` so
  parents + standalones come through and individual variants
  stay hidden until tapped.
- **Live-safe.** Pure read-only API change — no schema, no
  migration. Older cached client bundles continue to render
  their existing fields without crashing; only the new
  variant tile strip is gated on the new `variants` field.

## 1.0.37 — admin Menu: addon names inline on each parent row (2026-04-26)

No Electron-shell changes. Rebundles apps/admin only:

- Replaces the opaque `+A • 2` count badge on each menu row with
  **inline chips listing every attached addon by name** — admin
  can see at a glance that "Burger" carries `Cheese Sauce`,
  `Extra Patty`, `Bacon`, and `BBQ Sauce` without opening the
  Addon Groups dialog.
- Each chip is hover-titled with its addon group ("Sides" /
  "Sauces" / etc.) so admin can tell which group a particular
  addon belongs to.
- Long lists cap at 6 chips with a `+N more` tail (also hover-
  titled with the full overflow list) so a parent with 30 addon
  options doesn't blow the row layout out.

## 1.0.36 — admin Menu: bulk move-to-category (2026-04-26)

No Electron-shell changes. Rebundles apps/admin only:

- The bulk action bar on **Admin → Menu** (visible whenever ≥1
  row is checked) gets a second action: **Move to Category**.
  Pick a destination from the dropdown (parents listed first,
  sub-categories grouped under their parent as `Parent → Sub`),
  hit **Move**, and every selected item is reassigned in
  parallel. Same fan-out PATCH pattern as the existing Kitchen
  Section assignment — no new endpoint needed.
- The bar restructures so each action is its own row with a
  fixed-width label, keeping both pickers readable on smaller
  admin viewports.

## 1.0.35 — QR addon-aware quick-add + website ingredient alias (2026-04-26)

No Electron-shell changes. Rebundles apps/admin + apps/api +
apps/qr-order + @restora/types:

- **QR menu `+` button now respects addons.** Tapping the small
  quick-add button on a card whose menu item has at least one
  addon group routes to the item detail page (which already runs
  the addon picker) instead of silently adding the base item to
  cart. Plain items add directly as before.
- **Ingredient website display name.** New optional alias on each
  Ingredient — admin sets it on the InventoryPage edit dialog
  (under the "Show on website" checkbox). When set, the public
  website menu (and the qr-order item page) shows the alias in
  place of the inventory name. Empty falls back to the real name
  so existing items render unchanged. Use case: hide internal
  cataloguing names like "Garlic Powder" behind a customer-
  friendly "Aromatic Garlic" without renaming the inventory row
  (which would break recipes + reports).
- **Migration** `20260426190000_add_ingredient_website_display_name`
  is pure additive (single nullable TEXT column on `ingredients`).
  Server-side fallback engages whether or not the field is set,
  so live render stays identical until admin opts in per
  ingredient.

## 1.0.34 — Performance: Price Volatility shows correct unit (2026-04-26)

No Electron-shell changes. Rebundles apps/admin + apps/api +
@restora/types:

- The **Inventory Price Volatility** panel on Performance Report
  was showing the wrong unit. The cost columns are denominated
  in the supplier's PURCHASE unit (PACK / BOTTLE / KG bag) but
  the Unit column was rendering the ingredient's STOCK unit
  (G / ML / PCS). Result: a row would read "Soy Sauce —
  Unit: ML — Latest: ৳450" implying ৳450 per ML, when it
  actually meant ৳450 per BOTTLE.
- Fix exposes `purchaseUnit`, `stockUnit`, and `purchaseUnitQty`
  on each volatility row. The Unit column now shows the purchase
  unit (the truth-aligned label), with a small grey "= 200 G"
  hint underneath when the two units differ. The Latest cost
  cell also gets a derived "৳2.25 / G" line so admin can sanity-
  check both perspectives at once.
- Print template gets the same treatment plus a "(prices per
  purchase unit)" subheading so a printed PDF can't be
  misread.
- Pure read-only fix. No schema, no migration. Old field `unit`
  is retained on the response (now aliased to purchaseUnit) so
  any cached client bundle continues to render without a crash.

## 1.0.33 — re-delete legacy apps/qr/ (DO component now removed) (2026-04-26)

No Electron-shell changes. Repo cleanup:

- Owner has removed the `qr` build component from DigitalOcean
  App Platform, so the legacy `apps/qr/` workspace can finally
  be deleted for good. All production traffic at `/qr` continues
  to be served by `apps/qr-order/`.
- This is the second attempt at the same cleanup; the first
  (v1.0.27) broke the deploy because the DO config still
  referenced the directory. v1.0.32 restored it; this version
  re-removes it now that the DO config is clean.

## 1.0.32 — restore apps/qr/ to unblock DigitalOcean deploy (2026-04-26)

No Electron-shell changes. Restoration:

- DigitalOcean App Platform still has a `qr` build component
  pointing at `apps/qr/`. Deleting the directory in v1.0.27
  broke the deploy pipeline (Build Error: Non-Zero Exit on the
  `qr` job). Restored the legacy `apps/qr/` workspace from git
  history so the build job has something to compile again.
- The legacy bundle is **not used in production** — Caddy still
  routes `/qr` → `apps/qr-order/`, the codecanyon packager only
  ships `qr-order`, and zero application code imports from
  `@restora/qr`. The restored bundle just satisfies the existing
  DO build component.
- **TODO for owner:** in DigitalOcean → App Platform settings,
  remove the `qr` build component (and its `apps/qr/` source
  path) so the legacy app can be deleted again on the next
  cleanup pass. Until that's done, the directory has to stay.

## 1.0.31 — Pre-Ready picker: dedupe "[PR] X" double-listing (2026-04-26)

No Electron-shell changes. Rebundles apps/admin only:

- The Pre-Ready recipe builder's ingredient picker was showing
  every pre-ready item TWICE — once from the Ingredient table
  (the auto-mirrored `[PR] <name>` row with itemCode `PR-XXXXXX`)
  and once from the PreReadyItem table itself. Same display name,
  no real duplicate in the database — the dropdown was just
  concatenating two sources. Confused admin into thinking they
  had duplicate inventory.
- Now we hide the PreReadyItem entry whenever its mirror
  ingredient (`name === "[PR] <pr.name>"`) is already in the
  ingredient list — which is the normal case since v1.0.11
  auto-creates the mirror on pre-ready creation. The remaining
  ingredient row carries the cost + itemCode + stock and is the
  only one that was ever selectable anyway.
- Pure UX cleanup. No schema, no migration. Selecting the
  pre-ready row was already blocked by the matcher; this just
  stops it appearing.

## 1.0.30 — admin Recipes + Pre-Ready: additive "Copy from" (2026-04-26)

No Electron-shell changes. Rebundles apps/admin only:

- Both **admin Recipes** page and **admin Pre-Ready** recipe
  builder now use the same additive merge as the POS Custom Menu
  Dialog: tapping a "Copy from" source **adds** that recipe's
  ingredients to the working list instead of overwriting it.
  Stack as many sources as needed.
- **Same-ingredient + same-unit lines are summed** so the server-
  side `(recipeId, ingredientId)` unique constraint never trips.
  Different units are kept separate (10g salt + 1kg salt → two
  rows, not auto-converted).
- The picker stays open after each copy so admin can keep adding;
  the just-tapped row flashes a green ✓ Copied badge for ~1.2s as
  feedback. **Done** button replaces the previous Cancel.
- Empty / placeholder rows the user is mid-creating pass through
  unchanged at the tail; they're never auto-collapsed into the
  merged set.

## 1.0.29 — Recipes page: "Missing recipes only" filter (2026-04-26)

No Electron-shell changes. Rebundles apps/admin only:

- New **"Missing recipes only"** toggle on the Recipes page
  (under the existing search + ingredient filter). Click to
  collapse the menu-item list to only items that don't have a
  recipe authored yet. Click again to clear.
- Lets owner spot-check what's still owed at a glance — items
  missing a recipe never deduct stock or show real food cost,
  so they were silently slipping through. Detection uses the
  existing `getAllCosts` map (which emits one entry per recipe
  in DB, even when total cost is zero), so it's accurate even
  for recipes whose ingredients all cost ৳0.

## 1.0.28 — Recipes page hides variant parent shells (2026-04-26)

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

## 1.0.27 — delete legacy apps/qr (qr-order is the only QR app) (2026-04-26)

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

## 1.0.26 — admin Recipes page surfaces addons (2026-04-26)

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

## 1.0.25 — qr-order: parent categories only + scroll arrows (2026-04-26)

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

## 1.0.24 — Inventory: "Unused" pill surfaces dead-stock ingredients (2026-04-26)

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

## 1.0.23 — website Menu category nav: scroll arrows + edge fade (2026-04-26)

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

## 1.0.22 — supplier ledger adjustments (2026-04-26)

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

## 1.0.21 — admin Menu: variants render under their parent (2026-04-26)

No Electron-shell changes. Rebundles apps/admin:

- **Variant rows now nest directly under their parent** in the admin
  Menu list — `Latte (PARENT • 3)` immediately followed by `Latte –
  Single`, `Latte – Double`, etc., instead of being scattered
  alphabetically across the table. Standalone items render first,
  then each parent + its variants, then any orphan variants whose
  parent is filtered out by the search/category. No data change —
  client-side ordering only.

## 1.0.20 — admin sidebar: collapsible groups + quick-jump search (2026-04-25)

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

## 1.0.19 — non-recipe supplies tracking (2026-04-25)

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

## 1.0.18 — +ADD ticket prints addons + customise lines (2026-04-25)

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

## 1.0.17 — apply QR addons/notes/customise to qr-order app (2026-04-25)

Hotfix follow-up to 1.0.16. The previous rollout added QR addon
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

## 1.0.16 — table timers + QR addons/variants + self-remove toggle (2026-04-25)

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

## 1.0.15 — addons / modifiers (Phase 3) (2026-04-25)

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

## 1.0.14 — per-order ingredient removal (Phase 2) (2026-04-25)

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

## 1.0.13 — menu variants (Phase 1 of variants/mods/addons) (2026-04-25)

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

## 1.0.12 — performance report + POS Customised Menu (2026-04-25)

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

## 1.0.11 — pre-ready cost-per-unit + auto inventory mirror (2026-04-25)

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

## 1.0.10 — payment correction + items-sold report (2026-04-25)

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

## 1.0.9 — receive: discount + extra fees (2026-04-25)

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

## 1.0.8 — admin-configurable custom roles (2026-04-25)

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

## 1.0.7 — auto round-to-taka + Mushak display fix (2026-04-23)

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

## 1.0.6 — NBR Mushak (Bangladesh VAT) (2026-04-23)

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

## 1.0.5 — desktop KDS socket fix (2026-04-23)

No Electron-shell changes. Rebundles apps/pos:

- **KDS Start / Done now work inside the desktop POS.** The embedded
  KitchenPage used to open a socket with a relative '/ws' path that
  resolved against the Electron renderer origin (not the paired API
  server), so Start and Done clicks emitted to nowhere. The socket
  now asks the main process for the paired serverUrl at connect
  time and targets the API host directly.

## 1.0.4 — KOT rework + waiter pool opened (2026-04-23)

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

## 1.0.3 — purchasing accuracy + SMS backup coverage (2026-04-23)

No Electron-shell changes. Rebundles apps/pos + @restora/utils:

- **Variant pack size in PO + receive + ledger rows.** Variant
  ingredients now render as `Parent — Brand (PackSize)` across the
  purchasing list, receive screen, return list, and supplier ledger
  (via the new shared `ingredientDisplayName` helper). Previously a
  1L bottle and a 5L bottle of the same brand looked identical.
- **PO line + grand total use received qty on over-delivery.** When
  a supplier ships more than the PO ordered, the on-screen line total
  and PO grand total now multiply unitCost × received instead of
  × ordered, matching what the print export and supplier ledger
  already do.
- **Variant cost/unit derivation.** `createVariant`, update, and
  bulk CSV import now auto-derive `costPerUnit` from
  `costPerPurchaseUnit / purchaseUnitQty` so the inventory Cost/Unit
  column and daily consumption valuation stop showing 0 or the
  pack-level price for variants. One-shot Owner-only repair endpoint
  `POST /ingredients/repair-variant-costs` fixes existing rows.
- **Reconciliation double-count fix.** Supplier + payroll payouts
  auto-create mirror Expense rows; the work-period balance builder
  now filters these out so the admin Daily Report's Expected column
  matches the POS close-day live balance (previously off by the sum
  of supplier + salary payments).
- **Auto-link supplier on PO + receive.** Pairing an ingredient with
  a supplier on a PO upserts the IngredientSupplier row and, if the
  ingredient had no primary supplier, promotes this one — so the
  shopping list pre-fills the supplier on the next order.

No Electron main-process changes; dev-build-sig updater path unchanged.

## 1.0.2 — advisor/waiter POS access + UI polish (2026-04-23)

No Electron-shell changes. Rebundles apps/pos + @restora/utils:

- **ADVISOR + WAITER get cashier-tier POS access.** `requirePermission`
  runs all three through the same configurable action matrix (NONE/
  AUTO/OTP). One owner-configured policy governs all.
- **Advisor Start-Day** fixed — `/accounts` read widened so the
  opening-cash picker populates instead of saying "No POS accounts
  configured".
- **Wider admin purchasing form** (max-w-3xl → max-w-6xl) so the
  ingredient cell doesn't clip long variant labels.
- **Add/Edit Ingredient dialog** now has a sticky header + footer
  and a scrollable middle — Save button is always reachable.
- **Backup accessor guard** — backups no longer crash when a Prisma
  client is older than the BACKUP_MODELS list; missing accessors
  log a warning and other models still back up.

## 1.0.1 — embedded POS refresh (2026-04-23)

No Electron-shell changes. Rebundles `apps/pos` + `@restora/utils` so
terminals pick up the server-side improvements since 1.0.0:

- **Canonical variant labels** on the Create-PO search + receive rows.
  Format is `Parent — Brand Pack UNIT (PurchaseUnit) (extended)` via
  the shared `formatVariantLabel` helper.
- **Auto-SKU / itemCode** generation when admin leaves them blank, so
  every variant is targetable by the Stock Update CSV.
- **Stock Update CSV** round-trip works for variants too — the `sku`
  column is now in the export + the import template.
- **Per-user `canAccessPos` gate** propagates to the desktop lock
  screen (users flipped off in admin disappear from the tile grid).
- **Parent unit cascade** — flipping a parent's unit (e.g. G → PCS)
  updates every variant in one DB call so the unit shown on the POS
  line matches the parent.
- **Variant delete** when stock = 0, with parent-stock resync.
- **ADVISOR role** in the session bridge.
- **Shopping-list supplier grouping** on print.
- **Staff-password update fix** (no more raw-password Prisma crash).

## 1.0.0 — first public release (2026-04-20)

- **First codecanyon-style release.** Same binary as 0.9.1 plus tighter packaging excludes (no `.spec.ts`, no MSBuild `.recipe`/`.tlog`, no `obj/` build artefacts) so `app.asar` is brand-clean and ~6 MB smaller.
- **Buyer docs shipped**: `docs/INSTALL.md`, `docs/LICENSE.md`, `docs/UPDATE.md` covering first-launch flow, recovery scenarios, and re-download upgrade path.
- License + pairing flow verified end-to-end against `restora-pos-desktop-cc` on `api.neawaslic.top`.

## 0.9.1 — disable github auto-updater (2026-04-20)

- **Auto-updater disabled** for the codecanyon edition. The placeholder `publish.repo` in `electron-builder.yml` was hitting GitHub 404 on every launch and surfacing "Update failed 404" in the toast. Buyers re-download the next release from the seller's checkout.

## 0.9.0 — license activation (2026-04-20)

- **First-run flow now License → Pairing → Lock.** Fresh installs prompt for a purchase code from the seller's checkout before the device-pairing step. Activations bind to the Windows MachineGuid so a copied install file doesn't dual-activate.
- **One license per Windows install.** Activation slot is keyed by `sha256(MachineGuid + hostname + app salt)`, derived in main process — renderer never sees the raw fingerprint.
- **Server URL + product SKU + ed25519 public key are baked into the main bundle**, not env-read. A buyer can edit `.env` but they can't trivially patch the compiled `dist/main/index.js` to point at a mock license server.
- **DPAPI-encrypted local cache** at `%APPDATA%/Your Restaurant POS/license.enc`, mirroring the existing config blob: per-user Windows DPAPI on real machines, plaintext fallback on dev hosts.
- **Hourly background verify** in main process. Verdict transitions (active → grace → locked) are pushed to the renderer via `desktop:license:verdict-changed` so the cashier sees `LicenseRequiredScreen` within minutes of a server-side revoke, no restart required.
- **Offline grace: 7 days** (handled by `@restora/license-client`). Cached proof keeps the app working through router outages; clock-rewinding doesn't extend grace because the window is measured against `lastVerifiedAtMs` not the proof's `issuedAt`.
- **`window.desktop.license.{status,activate,deactivate,onVerdictChanged}`** added to the preload bridge.

## 0.6.0 — installer + auto-update (2026-04-15)

- **`pnpm dist` now produces a working Windows installer.** `release/YourRestaurantPOS-Setup-{version}.exe` (~90 MB NSIS), along with `latest.yml` and `.blockmap` for auto-update.
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
- Printer config lives inside the DPAPI-encrypted config blob at `%APPDATA%/Your Restaurant POS/config.enc`.

## 0.2.0 — cashier lock screen + PIN auth (2026-04-15)

- **Lock screen**: grid of cashier tiles (auto-populated from paired branch). Each tile shows initials, name, role, and a "Set PIN" badge for first-time users.
- **PIN pad**: 4–6 digit PIN entry with 12-key numeric pad, auto-submit prompt, dot-masked display. Lockout after 3 wrong attempts (30 s) and 8 attempts (5 min).
- **First-time setup**: cashier enters password once → proves identity against the server → picks a 4–6 digit PIN stored locally as a bcrypt hash. Never repeats on this terminal.
- **Local SQLite** (`better-sqlite3`) at `%APPDATA%/Your Restaurant POS/local.db` — schema: `cashier_pins`, `cashiers` cache. Migrations run on app start.
- **In-memory session holder** in main process keeps access/refresh tokens; never exposed to renderer. Tokens do not persist across restarts by design.
- Backend: new `POST /devices/cashiers` endpoint (auth via device token) so terminals refresh their lock-screen list when online. `POST /devices/register` response also primes the cache.
- IPC surface: `window.desktop.cashier.{list, pinStatus, verifyPin, setPin}` + `window.desktop.session.{current, signout}`.

## 0.1.0 — device pairing (2026-04-15)

- **First-Run Setup screen**: owner enters server URL, credentials, branch id, terminal name.
- **DPAPI-encrypted config store** at `%APPDATA%/Your Restaurant POS/config.enc`. Device token never crosses the IPC bridge.
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
