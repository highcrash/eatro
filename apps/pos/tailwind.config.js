/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Legacy named colors (kept for the existing red theme)
        white: { DEFAULT: '#FFFFFF', warm: '#FAF9F7', soft: '#F2F1EE', muted: '#E8E6E2', border: '#DDD9D3' },
        black: { DEFAULT: '#0D0D0D', rich: '#161616', mid: '#1F1F1F', lite: '#2A2A2A', text: '#111111' },
        red: { DEFAULT: '#D62B2B', deep: '#A81F1F', bright: '#F03535' },

        // Theme-token utilities — driven by CSS variables set in lib/branding.ts.
        // Use these in new components: bg-theme-accent, text-theme-text, etc.
        theme: {
          bg:               'var(--theme-bg)',
          surface:          'var(--theme-surface)',
          'surface-alt':    'var(--theme-surface-alt)',
          border:           'var(--theme-border)',
          text:             'var(--theme-text)',
          'text-muted':     'var(--theme-text-muted)',
          accent:           'var(--theme-accent)',
          'accent-soft':    'var(--theme-accent-soft)',
          'accent-hover':   'var(--theme-accent-hover)',
          pop:              'var(--theme-pop)',
          'pop-soft':       'var(--theme-pop-soft)',
          warn:             'var(--theme-warn)',
          danger:           'var(--theme-danger)',
          info:             'var(--theme-info)',
          sidebar:          'var(--theme-sidebar)',
          'sidebar-text':   'var(--theme-sidebar-text)',
          'sidebar-active': 'var(--theme-sidebar-active-bg)',
          'sidebar-active-text': 'var(--theme-sidebar-active-text)',
        },
      },
      fontFamily: {
        display: ['Bebas Neue', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
        // Theme-driven fonts (Phase 3 components use font-theme-display / font-theme-body)
        'theme-display': ['var(--theme-font-display)'],
        'theme-body':    ['var(--theme-font-body)'],
      },
      borderRadius: {
        DEFAULT: '0', sm: '0', md: '0', lg: '0', xl: '0', '2xl': '0', full: '9999px',
        // Theme-driven radius (Phase 3 components use rounded-theme)
        theme: 'var(--theme-radius)',
      },
    },
  },
  plugins: [],
};
