import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@restora/types': path.resolve(__dirname, '../../packages/types/src'),
      '@restora/utils': path.resolve(__dirname, '../../packages/utils/src'),
    },
  },
  server: {
    port: 5175,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
