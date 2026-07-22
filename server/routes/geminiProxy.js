/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import https from 'https';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyRequestToken } from '../lib/auth.js';
import {
  activeConnections,
  MAX_CONCURRENT_LIVE_SESSIONS,
  tryConsumeDailyLiveSession,
} from '../lib/liveQuota.js';

const TARGET_HOST = 'generativelanguage.googleapis.com';

// Rate limiter for the HTTP proxy route
const apiProxyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Registers the HTTP /api-proxy route AND the WebSocket upgrade handler for
// the same path — both relay to the Gemini API and share the same
// Firebase-ID-token auth scheme, so they're kept together in one module.
export function registerGeminiProxyRoutes(app, server, { apiKey, projectId }) {
  // HTTP Proxy for Gemini API.
  // Requires a verified Firebase ID token (same scheme as the WebSocket
  // proxy below) so this can't be used as a free, unauthenticated relay
  // for the Gemini API key.
  app.use('/api-proxy', cors(), apiProxyLimiter, async (req, res) => {
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    // In app.use('/api-proxy'), req.url is relative to the mount point.
    // So if the request is /api-proxy/v1beta/models..., req.url is /v1beta/models...
    let url;
    try {
      url = new URL(req.url, `https://${TARGET_HOST}`);
    } catch (e) {
      console.error('[Proxy] URL parse error', e);
      return res.status(400).json({ error: 'Invalid request URL' });
    }

    // The client SDK is configured to send the Firebase ID token as its
    // "apiKey" (query param "key"); also accept a Bearer header.
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const token = bearerToken || url.searchParams.get('key');

    let uid;
    try {
      uid = await verifyRequestToken(token, projectId || 'biostream-6490a');
    } catch (e) {
      console.warn('[Proxy] HTTP auth failed:', e.message);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Only now swap in the real key, once the caller is verified.
    url.searchParams.set('key', apiKey);
    const targetPath = url.pathname + url.search;

    console.log('[Proxy] HTTP ->', req.method, url.pathname, 'uid:', uid);

    const options = {
      hostname: TARGET_HOST,
      port: 443,
      path: targetPath,
      method: req.method,
      headers: {
        ...Object.fromEntries(
          Object.entries(req.headers).filter(([k]) =>
            !['host', 'origin', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'authorization'].includes(k.toLowerCase())
          )
        ),
        host: TARGET_HOST,

        origin: 'https://thenaturegram.com',
        referer: 'https://thenaturegram.com/',
        'x-goog-api-key': apiKey,
      },
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      console.error('[HTTP Proxy Error]', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Proxy error', details: err.message });
      }
    });

    req.pipe(proxyReq, { end: true });
  });

  // WebSocket Proxy for Gemini API
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const { pathname } = parse(req.url);
    if (pathname && pathname.startsWith('/api-proxy')) {
        let relUrl = req.url.replace(/^\/api-proxy\/+/, '/');

        let uid = null;
        let url;
        try {
          url = new URL(relUrl, `https://${TARGET_HOST}`);
          const token = url.searchParams.get('key');
          if (!token || token === 'PROXY') {
             console.error('[Proxy] No token provided');
             socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
             socket.destroy();
             return;
          }

          try {
             uid = await verifyRequestToken(token, projectId || 'biostream-6490a');
             console.log('[Proxy] Token verified for UID:', uid);
          } catch (e) {
             console.error('[Proxy] Token verification failed:', e.message);
             socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
             socket.destroy();
             return;
          }
        } catch (e) {
          console.error('[Proxy] Upgrade error during handshake', e.message);
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Endpoint Whitelisting
        const isBidi = url.pathname.toLowerCase().includes('bidigeneratecontent');
        if (!isBidi) {
           console.error('[Proxy] Invalid endpoint:', url.pathname);
           socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
           socket.destroy();
           return;
        }

        // Abuse/cost controls: cap concurrent and per-day Live sessions.
        // Checked before handleUpgrade so a rejected request never reaches
        // Gemini and never counts against activeConnections.
        const existingConns = activeConnections.get(uid);
        if (existingConns && existingConns.size >= MAX_CONCURRENT_LIVE_SESSIONS) {
           console.warn('[Proxy] Concurrent Live session limit reached for user', uid);
           socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
           socket.destroy();
           return;
        }
        if (!tryConsumeDailyLiveSession(uid)) {
           console.warn('[Proxy] Daily Live session limit reached for user', uid);
           socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
           socket.destroy();
           return;
        }

        wss.handleUpgrade(req, socket, head, (clientWs) => {

          const userActiveConns = activeConnections.get(uid) || new Set();
          userActiveConns.add(clientWs);
          activeConnections.set(uid, userActiveConns);

          // 3 minutes session timeout
          const sessionTimeout = setTimeout(() => {
              console.log('[Proxy] Session max duration reached for user', uid);
              clientWs.close(1008, "Session max duration reached (3 mins)");
          }, 3 * 60 * 1000);

          clientWs.on('close', () => {
              clearTimeout(sessionTimeout);
              userActiveConns.delete(clientWs);
              if (userActiveConns.size === 0) {
                  activeConnections.delete(uid);
              }
          });

          if (!apiKey) {
            console.error('[Proxy] WS Upgrade failed: GEMINI_API_KEY not configured');
            clientWs.close();
            return;
          }
          const targetPathname = url.pathname;
          url.searchParams.set('key', apiKey);
          relUrl = url.pathname + url.search;

        const targetUrl = `wss://${TARGET_HOST}${relUrl}`;

        const myHeaders = {
            host: TARGET_HOST,
          };
          // Log only the pathname, never the full URL: it now carries the
          // real Gemini API key in its query string.
          console.log('[Proxy] WS Upgrade ->', targetPathname, 'uid:', uid);

        const targetWs = new WebSocket(targetUrl, {
          headers: myHeaders
        });

        const clientQueue = [];
        let targetOpen = false;

        targetWs.on('open', () => {
          console.log('[Proxy] Target WS connection opened');
          targetOpen = true;
          while(clientQueue.length) {
            const { data, isBinary } = clientQueue.shift();
            targetWs.send(data, { binary: isBinary });
          }
        });

        // Note: message bodies are intentionally not logged here — they can
        // contain user audio transcripts and other conversation content.
        clientWs.on('message', (data, isBinary) => {
          if (targetOpen) {
            targetWs.send(data, { binary: isBinary });
          } else {
            clientQueue.push({ data, isBinary });
          }
        });

        targetWs.on('close', (code, reason) => {
          console.log('[Proxy] Target WS closed', code, reason.toString());
          clientWs.close(code, reason);
        });

        targetWs.on('message', (data, isBinary) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: isBinary });
          }
        });

        clientWs.on('close', (code, reason) => {
          console.log('[Proxy] Client WS closed', code, reason.toString());
          const safeCode = (code === 1005 || code < 1000 || code > 4999) ? 1000 : code;
          targetWs.close(safeCode, reason);
        });

        clientWs.on('error', (err) => {
          console.error('[WS Proxy Client Error]', err.message);
          targetWs.terminate();
        });
        targetWs.on('error', (err) => {
          console.error('[WS Proxy Target Error]', err.message);
          clientWs.terminate();
        });
      });
    }
  });
}
