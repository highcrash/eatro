/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        white: { DEFAULT: '#FFFFFF', warm: '#FAF9F7', soft: '#F2F1EE', muted: '#E8E6E2', border: '#DDD9D3' },
        black: { DEFAULT: '#0D0D0D', rich: '#161616', mid: '#1F1F1F', lite: '#2A2A2A', text: '#111111' },
        red: { DEFAULT: '#D62B2B', deep: '#A81F1F', bright: '#F03535' },
      },
      fontFamily: { display: ['Bebas Neue', 'sans-serif'], body: ['DM Sans', 'sans-serif'], mono: ['DM Mono', 'monospace'] },
      borderRadius: { DEFAULT: '0', sm: '0', md: '0', lg: '0', xl: '0', '2xl': '0', full: '9999px' },
    },
  },
  plugins: [],
};
