/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        black: { DEFAULT: '#0D0D0D', rich: '#161616', mid: '#1F1F1F', lite: '#2A2A2A' },
        white: { DEFAULT: '#FFFFFF', warm: '#FAF9F7', border: '#DDD9D3' },
        red: { DEFAULT: '#D62B2B', bright: '#F03535' },
      },
      fontFamily: { display: ['Bebas Neue', 'sans-serif'], body: ['DM Sans', 'sans-serif'] },
      borderRadius: { DEFAULT: '0', sm: '0', md: '0', lg: '0', xl: '0', full: '9999px' },
    },
  },
  plugins: [],
};
