# Changelog — Restora POS Desktop

All notable changes to the desktop cashier app are documented here.
Versioning follows SemVer. Tags are `pos-desktop-v{version}`.

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
