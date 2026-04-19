import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Force the new service worker to take over immediately on deploy.
      // Without this, returning guests stay stuck on whatever bundle
      // their PWA installed on their first visit — which is how the QR
      // gate fix was unable to reach users with a previously cached
      // service worker.
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // API responses (especially /public/qr-gate) must never be cached
        // by the SW — the gate verdict depends on the caller's IP and a
        // stale "allowed: true" trivially opens the gate for everyone.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'QR Order',
        short_name: 'QR Order',
        description: 'Scan, Browse & Order — QR Self-Order',
        theme_color: '#0D0D0D',
        background_color: '#0D0D0D',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@restora/types': path.resolve(__dirname, '../../packages/types/src'),
      '@restora/utils': path.resolve(__dirname, '../../packages/utils/src'),
    },
  },
  server: {
    port: 5176,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
