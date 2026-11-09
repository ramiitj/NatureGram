import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
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
