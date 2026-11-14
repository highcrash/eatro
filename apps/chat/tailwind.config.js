/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#fff3d9',
        beet: { DEFAULT: '#c15c58', dark: '#9e4744', soft: '#f6e1dc' },
        amber: { brand: '#E99207' },
        ink: { DEFAULT: '#2b2b2b', soft: '#6F6F6F', line: '#e8dcc4' },
      },
      fontFamily: { sans: ['Montserrat', 'Hind Siliguri', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
