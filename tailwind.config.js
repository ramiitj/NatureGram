/** @type {import('tailwindcss').Config} */
// Mirrors the theme.extend block that used to live inline in index.html's
// tailwind.config (Play CDN) script 1:1 — this is a build-time replacement
// for that runtime config, not a redesign. Copy any values here verbatim
// if the CDN script ever comes back, and vice versa.
export default {
  content: ['./index.html', './App.tsx', './components/**/*.tsx'],
  theme: {
    extend: {
      colors: {
        // V1: deep pine/moss defaults (see index.css's :root for the
        // rationale) — replaces the previous warm-orange-on-cream cliché
        // fallback with something that reads as "field instrument," not
        // "cozy blog."
        primary: 'var(--theme-primary, #1c2b22)',
        accent: 'var(--theme-accent, #3f7a54)',
        'day-bg': '#fcfaf8',
        surface: '#ffffff',
        'text-main': '#1c1917',
        'text-muted': '#78716c',
        'insight-bg': '#fdf8f1',
        'theme-primary': 'rgb(var(--theme-primary-rgb, 28 43 34) / <alpha-value>)',
        'theme-primary-gradient': 'var(--theme-primary-gradient, #2d4a36)',
        'theme-shadow': 'rgb(var(--theme-shadow-rgb, 13 21 18) / <alpha-value>)',
        'theme-text': 'var(--theme-text, #eef5ef)',
        'theme-accent': 'rgb(var(--theme-accent-rgb, 63 122 84) / <alpha-value>)',
      },
      fontFamily: {
        // V1: Fraunces (a variable serif with real optical-size character)
        // replaces Playfair Display — a common "elegant AI app" default —
        // and JetBrains Mono gives identification-heavy surfaces
        // (specimen tags, timestamps, confidence readouts) a field-
        // instrument feel instead of borrowing the body sans for numerals.
        display: ['Fraunces', 'serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'wave-bar': 'wave 1s ease-in-out infinite',
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'slide-up': 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-in-right': 'slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        float: 'float 6s ease-in-out infinite',
      },
      keyframes: {
        wave: { '0%, 100%': { height: '15%' }, '50%': { height: '100%' } },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        slideInRight: { '0%': { transform: 'translateX(20px)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      },
    },
  },
  plugins: [],
};
