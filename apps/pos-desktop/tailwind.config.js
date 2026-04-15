/** @type {import('tailwindcss').Config} */
// Shares visual language with apps/pos so components imported from there render
// identically here. Scans BOTH the desktop renderer's own files and the linked
// POS sources we pull in.
import posConfig from '../pos/tailwind.config.js';

export default {
  ...posConfig,
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{ts,tsx}',
    '../pos/src/**/*.{ts,tsx}',
  ],
};
