import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { NATURALIST_THEMES } from './constants/naturalists';
import { NATURALIST_EXTRAS } from './constants/naturalistExtras';

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

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react(), seoData()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
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
