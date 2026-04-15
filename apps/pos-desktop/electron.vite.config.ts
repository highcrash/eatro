import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// electron-vite wires three independent bundles (main, preload, renderer).
// `externalizeDepsPlugin()` keeps native + node-only modules (better-sqlite3,
// bcryptjs, electron) out of the bundle so they're loaded at runtime from
// node_modules — required for native bindings to work.
//
// Workspace-linked packages (@restora/types, @restora/utils) must be BUNDLED
// (not externalized) otherwise electron-builder's asar packer follows pnpm's
// symlinks back into packages/*/dist and errors because those files live
// outside the app dir.
//
// The renderer bundle pulls React, the web POS app, and its dependencies.
// Paths are aliased so imports like `@pos/App` resolve into apps/pos/src.
const WORKSPACE_DEPS = ['@restora/types', '@restora/utils'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_DEPS })],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
    resolve: {
      alias: {
        '@restora/types': resolve(__dirname, '../../packages/types/src'),
        '@restora/utils': resolve(__dirname, '../../packages/utils/src'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_DEPS })],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
    resolve: {
      alias: {
        '@restora/types': resolve(__dirname, '../../packages/types/src'),
        '@restora/utils': resolve(__dirname, '../../packages/utils/src'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@pos': resolve(__dirname, '../pos/src'),
        // Some POS files import types from these workspace packages using
        // bare specifiers — make sure they land at the linked sources, not
        // stale dist copies.
        '@restora/types': resolve(__dirname, '../../packages/types/src'),
        '@restora/utils': resolve(__dirname, '../../packages/utils/src'),
      },
    },
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
