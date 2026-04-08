import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Restora Order',
        short_name: 'Restora',
        description: 'Scan, Browse & Order — Restora QR Self-Order',
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
