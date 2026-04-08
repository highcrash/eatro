/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        white: { DEFAULT: '#FFFFFF', warm: '#FAF9F7', soft: '#F2F1EE', border: '#DDD9D3' },
        black: { DEFAULT: '#0D0D0D', text: '#111111' },
        red: { DEFAULT: '#D62B2B', deep: '#A81F1F', bright: '#F03535' },
      },
      fontFamily: { display: ['Bebas Neue', 'sans-serif'], body: ['DM Sans', 'sans-serif'] },
      borderRadius: { DEFAULT: '0', sm: '0', md: '0', lg: '0', xl: '0', full: '9999px' },
    },
  },
  plugins: [],
};
