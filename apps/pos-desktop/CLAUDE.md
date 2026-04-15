# pos-desktop — Architecture & Conventions

This file is loaded automatically when Claude Code is working in `apps/pos-desktop/`.
Read it before making changes here. The long-form implementation plan lives at
`C:/Users/highc/.claude/plans/clever-wibbling-biscuit.md` — refer to it for the full
phase roadmap.

## What this app is

A **Windows-only Electron cashier terminal** that wraps the existing web POS UI
(`apps/pos`) and adds native capabilities the browser cannot provide:

1. Silent ESC/POS printing to a kitchen thermal printer (80 mm)
2. Silent ESC/POS printing to a bill / receipt thermal printer (80 mm)
3. Silent A4 printing to a Windows office printer for reports
4. Cash-drawer kick on cash payment
5. Offline-resilient order entry (mutations queue locally, drain on reconnect)
6. DPAPI-encrypted device credentials + local bcrypt PIN auth for cashiers

The app is paired to a specific Restora API server + branch at first run by
the owner; after that, only cashier PINs are needed to use it, even offline.

## Process model — THIS IS THE MOST IMPORTANT RULE

Electron has two processes. Do NOT confuse them.

| Process | What runs here | Allowed |
|---|---|---|
| **main** (`src/main/**`) | Node.js. Full filesystem, sockets, native modules (`node-thermal-printer`, `better-sqlite3`, DPAPI bindings). | Printers, disk, SQLite, DPAPI, HTTPS to the API, IPC handlers. |
| **renderer** (`src/renderer/**`) | Chromium. React UI. No Node APIs. | DOM, React, fetch. Calls into main via `window.desktop.*`. |
| **preload** (`src/preload/**`) | Small bridge. Uses `contextBridge` to expose a tiny typed API to the renderer. | ONLY method forwarding to `ipcRenderer.invoke`. No business logic. |

**NEVER** put hardware code, DPAPI calls, or SQLite access in the renderer.
**NEVER** put React or DOM code in the main process.
**NEVER** enable `nodeIntegration: true` or disable `contextIsolation`.
If you need a new native capability in the UI, add an IPC handler in main, a
preload bridge method, and call it from the renderer via `window.desktop.*`.

## Code reuse from the web POS

The `renderer/` tree imports freely from `apps/pos/src/**`. The desktop app
**does not fork** any POS screens — if you need a behaviour difference, add a
flag that both apps read (e.g. via `@restora/types`) rather than copying code.

Desktop-only screens that don't exist in the web POS:

- First-Run Setup (server URL + owner login + device registration)
- Cashier Lock Screen (PIN grid)
- Printer Settings (per-slot printer selection + test print)

Those live in `src/renderer/*.tsx` and are rendered instead of the POS UI when
the local state requires them.

## Schema changes propagate automatically

`@restora/types` is workspace-linked. If a Prisma model touched by this app
changes (`Order`, `OrderItem`, `Staff`, `Device`, `BranchSetting`), the next
type-check in this workspace will break at the exact site of the mismatch.
When reviewing PRs that touch `prisma/schema.prisma`, always re-run
`pnpm --filter @restora/pos-desktop type-check`.

## What Phase 0 shipped

- Workspace scaffolding (`package.json`, tsconfigs split for node vs web)
- `electron-vite` build pipeline
- Blank Electron window that loads a placeholder React view
- `contextBridge` stub exposing `window.desktop = { version, phase }` — nothing more
- `electron-builder.yml` targeting Windows NSIS, output to `release/`
- Release workflow file (currently disabled — uncomment `on:` when Phase 6 lands)
- This CLAUDE.md + CHANGELOG.md + README.md

## Out of scope for this app (now and forever)

- The admin panel — owners continue to use `apps/admin`.
- The KDS — continues to be `apps/kds`, a separate web app.
- macOS and Linux builds. `electron-builder.yml` is Windows-only by design.
- Direct database access. The desktop app only ever talks to the API.

## Release flow (once Phase 6 is live)

1. Bump `version` in `apps/pos-desktop/package.json`.
2. Append a section to `CHANGELOG.md`.
3. `git tag pos-desktop-v{version} && git push --tags`.
4. GitHub Actions builds `RestoraPOS-Setup-{version}.exe` + `latest.yml` and
   publishes them to the GitHub release named `pos-desktop-v{version}`.
5. Installed terminals pick up the new build on next launch via
   `electron-updater` reading `latest.yml`.

## Dev-run

```
pnpm install
pnpm dev              # in one terminal — starts API + web apps (pos-desktop excluded by default)
pnpm dev:desktop      # in a second terminal — starts the Electron app
```

The root `pnpm dev` deliberately excludes `@restora/pos-desktop` (Electron is
heavy and the desktop app needs the API already running). Use `pnpm dev:all`
only if you want to launch everything at once (bumps turbo concurrency).

First Electron window opens in a few seconds showing the First-Run Setup
screen. The main process logs `desktop-shell-ready` to stdout.
