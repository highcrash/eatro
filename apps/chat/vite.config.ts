import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Our own service worker, so it can show push notifications.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      // A classic (non-module) worker: older iPhones can't run module workers.
      injectManifest: { rollupFormat: 'iife', globPatterns: ['**/*.{js,css,html,png,ico,svg}'] },
      manifest: {
        name: 'EATRO Staff Chat',
        short_name: 'EATRO Chat',
        description: 'Answer EATRO customer chats, comments and complaints.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#c15c58',
        background_color: '#fff3d9',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@restora/types': path.resolve(__dirname, '../../packages/types/src'),
    },
  },
  server: {
    port: 5179,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
