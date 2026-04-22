# Changelog — Restora POS Desktop

All notable changes to the desktop cashier app are documented here.
Versioning follows SemVer. Tags are `pos-desktop-v{version}`.

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
