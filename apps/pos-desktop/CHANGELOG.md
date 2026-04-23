# Changelog — Your Restaurant POS Desktop

All notable changes to the desktop cashier app are documented here.
Versioning follows SemVer. Tags are `pos-desktop-v{version}`.

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
