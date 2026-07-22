/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

import { initFirebaseAdmin } from './lib/auth.js';
import { registerSharePreviewRoute } from './routes/sharePreview.js';
import { registerGeminiProxyRoutes } from './routes/geminiProxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');

const currentFirebaseProjectId = initFirebaseAdmin(REPO_ROOT);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const API_KEY = process.env.GEMINI_API_KEY;
  console.log('Server starting. GEMINI_API_KEY configured:', !!API_KEY);

  // Trust proxy for rate limiting behind Cloud Run/Nginx
  app.set('trust proxy', 1);

  // Allow standard CORS to support iframe preview environments correctly
  app.use(cors());

  // Note: there used to be an /api/media-proxy route here to work around
  // CORS when fetching Firebase Storage/Unsplash/Wikimedia images from the
  // browser. Verified live that all three already send
  // "Access-Control-Allow-Origin: *" on their actual download responses,
  // so the proxy hop was pure unnecessary latency/Cloud Run cost (and
  // attack surface) — removed. The client now fetches those URLs directly
  // (see getCorsProxyUrl in services/firebaseService.ts).

  const server = http.createServer(app);

  // Route registration order matters: these two are specific paths and
  // must be registered before the catch-all static/Vite middleware below,
  // or that middleware would swallow requests to them first.
  registerSharePreviewRoute(app);
  registerGeminiProxyRoutes(app, server, {
    apiKey: API_KEY,
    projectId: currentFirebaseProjectId,
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server }
      },
      appType: 'spa',
      root: REPO_ROOT
    });
    app.use(vite.middlewares);
  } else {
    // Serve static frontend in production
    const staticPath = path.join(REPO_ROOT, 'dist');
    app.use(express.static(staticPath));

    // Final fallback for SPA
    app.get('*all', (req, res) => {
        res.sendFile(path.join(staticPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port', PORT);
    console.log('WebSocket proxy enabled for /api-proxy -> generativelanguage.googleapis.com');
  });
}

startServer();
