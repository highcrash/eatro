# Your Restaurant POS — Desktop (Windows Cashier Terminal)

Electron app that wraps the web POS with native printing, cash drawer, and offline support.

## Status: Phase 0 (scaffolding)

Only the project shell is wired up. The window opens, a placeholder screen renders, and nothing else works yet. Phases 1–7 land the real features — see `C:/Users/highc/.claude/plans/clever-wibbling-biscuit.md`.

## Dev

```bash
pnpm install          # from repo root, once
pnpm --filter @restora/pos-desktop dev
```

Opens a 1280×800 Electron window showing the Phase 0 scaffolding screen. The main process prints `desktop-shell-ready` to stdout when the window is ready.

## Build an installer

```bash
pnpm --filter @restora/pos-desktop dist
```

Produces `apps/pos-desktop/release/YourRestaurantPOS-Setup-{version}.exe` plus `latest.yml` and `.blockmap` files used by auto-update. The installer runs on Windows 10+ x64.

## Layout

```
src/
├── main/       Electron main process (Node.js). Hardware, disk, IPC handlers.
├── preload/    contextBridge exposing a typed API to the renderer.
└── renderer/   React UI. Imports from apps/pos once Phase 5 wires it in.
```

See `CLAUDE.md` for architectural invariants — read it before contributing.
