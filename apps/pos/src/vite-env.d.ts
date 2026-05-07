/// <reference types="vite/client" />

// Pulls in Vite's ambient module declarations so non-JS asset
// imports (`*.mp3`, `*.png`, `*.svg`, etc.) resolve to a URL string
// at build time instead of tripping a "Cannot find module" type
// error. Required for the notification chime import in
// `hooks/useNotifications.ts` — Vite generates the right asset
// URL for the web POS deploy AND for the desktop electron-vite
// renderer build (where `/sounds/foo.mp3` would otherwise resolve
// against the filesystem root because the page is loaded via
// file:// instead of http://).
