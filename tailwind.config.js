import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './App.tsx', './index.tsx', './components/**/*.{ts,tsx}', './services/**/*.ts', './constants/**/*.ts', './*.ts'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--theme-primary, #44403c)',
        accent: 'rgb(var(--theme-accent-rgb, 194 65 12) / <alpha-value>)',
        'day-bg': '#fcfaf8',
        surface: '#ffffff',
        'text-main': '#1c1917',
        'text-muted': '#57534e',
        'insight-bg': '#fdf8f1',
        'theme-primary': 'rgb(var(--theme-primary-rgb, 68 64 60) / <alpha-value>)',
        'theme-primary-gradient': 'var(--theme-primary-gradient, #ea580c)',
        'theme-shadow': 'rgb(var(--theme-shadow-rgb, 0 0 0) / <alpha-value>)',
        'theme-text': 'var(--theme-text, #ffffff)',
        // Accessible accent (auto-darkened per naturalist to >= 4.5:1 on light backgrounds)
        'theme-accent': 'rgb(var(--theme-accent-rgb, 194 65 12) / <alpha-value>)',
        // The naturalist's original, vivid accent for glows, gradients and dark surfaces
        'theme-vivid': 'rgb(var(--theme-accent-vivid-rgb, 234 88 12) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Newsreader', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'wave-bar': 'wave 1s ease-in-out infinite',
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'slide-up': 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-in-right': 'slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        float: 'float 6s ease-in-out infinite',
        'pulse-gentle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        wave: { '0%, 100%': { height: '15%' }, '50%': { height: '100%' } },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(100%)' }, '100%': { transform: 'translateY(0)' } },
        slideInRight: { '0%': { transform: 'translateX(20px)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-20px)' } },
      },
    },
  },
  plugins: [animate],
};
