import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { NATURALIST_THEMES } from './constants/naturalists';
import { NATURALIST_EXTRAS } from './constants/naturalistExtras';
import ROTATION from './constants/palettes.json' with { type: 'json' };
import { themeInitScript } from './scripts/theme-init.mjs';

/**
 * The server renders public naturalist pages (/naturalists/:id) but ships without the app's
 * TypeScript sources, so the naturalists travel with the build as plain JSON (dist/seo/naturalists.json).
 */
const seoData = (): Plugin => ({
  name: 'naturegram-seo-data',
  apply: 'build',
  generateBundle() {
    const themes = NATURALIST_THEMES.map(({ id, naturalist, quote, locationName, locationCaption }) => ({ id, naturalist, quote, locationName, locationCaption }));
    this.emitFile({ type: 'asset', fileName: 'seo/naturalists.json', source: JSON.stringify({ themes, extras: NATURALIST_EXTRAS }) });
  },
});

/** /theme-init.js: the fortnight's palette before the first paint (see scripts/theme-init.mjs). */
const themeInit = (): Plugin => ({
  name: 'naturegram-theme-init',
  configureServer(server) {
    server.middlewares.use('/theme-init.js', (_req, res) => {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(themeInitScript(ROTATION));
    });
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'theme-init.js', source: themeInitScript(ROTATION) });
  },
});

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react(), seoData(), themeInit()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
    // One React, always: a second copy (e.g. from a dependency re-bundled mid-session in the dev server)
    // makes hooks run against a null dispatcher ("Cannot read properties of null (reading 'useState')")
    dedupe: ['react', 'react-dom'],
  },
  // Pre-bundle everything the app loads (including dev JSX runtime and @google/genai), so the dev
  // server and AI Studio's preview never re-optimise dependencies while a session is open, which
  // would load a second React with a new ?v= hash and break hooks in lazy views.
  optimizeDeps: {
    entries: ['index.html', 'App.tsx', 'components/**/*.tsx', 'services/**/*.ts'],
    include: [
      'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime',
      '@google/genai',
      'firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage',
      'firebase/functions', 'firebase/app-check', 'firebase/messaging',
      'motion/react', 'lucide-react',
    ],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks cache across deploys; app code changes don't bust them
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@google/genai')) return 'vendor-genai';
          // App Check loads only when a site key is set (services/appCheck.ts): keep it out of the shared chunk
          if (id.includes('app-check')) return 'vendor-appcheck';
          // Cloud Functions client: only the admin console's poster backfill uses it
          if (id.includes('firebase/functions') || id.includes('@firebase/functions')) return 'vendor-functions';
          if (id.includes('firebase/firestore') || id.includes('@firebase/firestore')) return 'vendor-firestore';
          if (id.includes('firebase') || id.includes('@firebase')) return 'vendor-firebase';
          if (id.includes('motion') || id.includes('framer')) return 'vendor-motion';
          if (id.includes('react')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
});
