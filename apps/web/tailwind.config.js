/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:     'var(--bg)',
        card:   'var(--card)',
        hover:  'var(--hover)',
        border: 'var(--border)',
        text:   'var(--text)',
        muted:  'var(--muted)',
        accent: 'var(--accent)',
        btn:    'var(--btn)',
      },
      fontFamily: {
        display: ['Bebas Neue', 'sans-serif'],
        body:    ['DM Sans', 'sans-serif'],
        serif:   ['Playfair Display', 'serif'],
        mono:    ['DM Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0',
        sm: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        full: '9999px',
      },
    },
  },
  plugins: [],
};
