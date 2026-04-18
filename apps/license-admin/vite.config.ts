import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5178,
    proxy: {
      // License server dev runs on :3002. Proxy /api to avoid CORS in
      // dev; in prod the admin UI is served from license-admin.<domain>
      // and calls license.<domain> directly (with CORS allowed for the
      // admin-UI origin on the server side).
      '/api': { target: 'http://localhost:3002', changeOrigin: true },
    },
  },
});
