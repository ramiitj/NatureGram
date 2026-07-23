/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import https from 'https';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyRequestToken } from '../lib/auth.js';
import {
  tryReserveConnection,
  releaseConnection,
  tryConsumeDailyLiveSession,
} from '../lib/liveQuota.js';
import { logger, newRequestId, logRequestTrace } from '../lib/logger.js';

const TARGET_HOST = 'generativelanguage.googleapis.com';

// Gemini REST/WS paths are always /v1beta/models/{model}:{method} — this is
// the only place "which model" is visible to the proxy at all (it never
// parses the relayed body), so every request/session trace below extracts
// it from here.
function extractModelFromPath(pathname) {
  const match = /\/models\/([^:/]+):/.exec(pathname || '');
  return match ? match[1] : null;
}

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
    const requestId = newRequestId();
    const startedAt = Date.now();

    if (!apiKey) {
      logRequestTrace({ requestId, route: 'http', latencyMs: Date.now() - startedAt, outcome: 'error', error: 'GEMINI_API_KEY not configured' });
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    // In app.use('/api-proxy'), req.url is relative to the mount point.
    // So if the request is /api-proxy/v1beta/models..., req.url is /v1beta/models...
    let url;
    try {
      url = new URL(req.url, `https://${TARGET_HOST}`);
    } catch (e) {
      logger.error('proxy_url_parse_error', { requestId, error: e.message });
      logRequestTrace({ requestId, route: 'http', latencyMs: Date.now() - startedAt, outcome: 'error', error: 'invalid request URL' });
      return res.status(400).json({ error: 'Invalid request URL' });
    }

    const model = extractModelFromPath(url.pathname);

    // The client SDK is configured to send the Firebase ID token as its
    // "apiKey" (query param "key"); also accept a Bearer header.
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const token = bearerToken || url.searchParams.get('key');

    let uid;
    try {
      uid = await verifyRequestToken(token, projectId);
    } catch (e) {
      logger.warn('proxy_http_auth_failed', { requestId, error: e.message });
      logRequestTrace({ requestId, route: 'http', model, latencyMs: Date.now() - startedAt, outcome: 'unauthorized' });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Only now swap in the real key, once the caller is verified.
    url.searchParams.set('key', apiKey);
    const targetPath = url.pathname + url.search;

    logger.info('proxy_http_request', { requestId, method: req.method, path: url.pathname, model, uid });

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
      res.on('finish', () => {
        logRequestTrace({
          requestId, route: 'http', model, uid,
          latencyMs: Date.now() - startedAt,
          outcome: proxyRes.statusCode < 400 ? 'success' : 'error',
        });
      });
    });

    proxyReq.on('error', (err) => {
      logger.error('proxy_http_upstream_error', { requestId, error: err.message });
      logRequestTrace({ requestId, route: 'http', model, uid, latencyMs: Date.now() - startedAt, outcome: 'error', error: err.message });
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
        const requestId = newRequestId();
        const startedAt = Date.now();
        let relUrl = req.url.replace(/^\/api-proxy\/+/, '/');

        let uid = null;
        let url;
        try {
          url = new URL(relUrl, `https://${TARGET_HOST}`);
          const token = url.searchParams.get('key');
          if (!token || token === 'PROXY') {
             logger.warn('proxy_ws_no_token', { requestId });
             logRequestTrace({ requestId, route: 'ws', latencyMs: Date.now() - startedAt, outcome: 'unauthorized' });
             socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
             socket.destroy();
             return;
          }

          try {
             uid = await verifyRequestToken(token, projectId);
          } catch (e) {
             logger.warn('proxy_ws_auth_failed', { requestId, error: e.message });
             logRequestTrace({ requestId, route: 'ws', latencyMs: Date.now() - startedAt, outcome: 'unauthorized' });
             socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
             socket.destroy();
             return;
          }
        } catch (e) {
          logger.error('proxy_ws_handshake_error', { requestId, error: e.message });
          logRequestTrace({ requestId, route: 'ws', latencyMs: Date.now() - startedAt, outcome: 'error', error: e.message });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const model = extractModelFromPath(url.pathname);

        // Endpoint Whitelisting
        const isBidi = url.pathname.toLowerCase().includes('bidigeneratecontent');
        if (!isBidi) {
           logger.warn('proxy_ws_invalid_endpoint', { requestId, uid, path: url.pathname });
           logRequestTrace({ requestId, route: 'ws', uid, model, latencyMs: Date.now() - startedAt, outcome: 'blocked' });
           socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
           socket.destroy();
           return;
        }

        // Abuse/cost controls: cap concurrent and per-day Live sessions.
        // Checked (and, for concurrency, atomically reserved) before
        // handleUpgrade so a rejected request never reaches Gemini. Both
        // checks are now Firestore-backed (see liveQuota.js) so they hold
        // correctly across multiple server replicas, not just within one.
        const connectionId = randomUUID();
        if (!(await tryReserveConnection(uid, connectionId))) {
           logger.warn('proxy_ws_concurrency_limit', { requestId, uid });
           logRequestTrace({ requestId, route: 'ws', uid, model, latencyMs: Date.now() - startedAt, outcome: 'quota_exceeded' });
           socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
           socket.destroy();
           return;
        }
        if (!(await tryConsumeDailyLiveSession(uid))) {
           logger.warn('proxy_ws_daily_limit', { requestId, uid });
           logRequestTrace({ requestId, route: 'ws', uid, model, latencyMs: Date.now() - startedAt, outcome: 'quota_exceeded' });
           socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
           socket.destroy();
           releaseConnection(uid, connectionId).catch(() => {});
           return;
        }

        wss.handleUpgrade(req, socket, head, (clientWs) => {

          // 3 minutes session timeout
          const sessionTimeout = setTimeout(() => {
              logger.info('proxy_ws_max_duration', { requestId, uid });
              clientWs.close(1008, "Session max duration reached (3 mins)");
          }, 3 * 60 * 1000);

          let sessionOutcome = 'success';
          clientWs.on('close', () => {
              clearTimeout(sessionTimeout);
              releaseConnection(uid, connectionId).catch(() => {});
              // The one trace line for this whole Live session: model,
              // total session duration as latencyMs, and how it ended.
              logRequestTrace({ requestId, route: 'ws', uid, model, latencyMs: Date.now() - startedAt, outcome: sessionOutcome });
          });

          if (!apiKey) {
            logger.error('proxy_ws_no_api_key', { requestId, uid });
            sessionOutcome = 'error';
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
          logger.info('proxy_ws_upgrade', { requestId, path: targetPathname, model, uid });

        const targetWs = new WebSocket(targetUrl, {
          headers: myHeaders
        });

        const clientQueue = [];
        let targetOpen = false;

        targetWs.on('open', () => {
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
          if (code >= 4000 || (code >= 1002 && code <= 1003)) sessionOutcome = 'error';
          clientWs.close(code, reason);
        });

        targetWs.on('message', (data, isBinary) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: isBinary });
          }
        });

        clientWs.on('close', (code, reason) => {
          const safeCode = (code === 1005 || code < 1000 || code > 4999) ? 1000 : code;
          targetWs.close(safeCode, reason);
        });

        clientWs.on('error', (err) => {
          logger.error('proxy_ws_client_error', { requestId, uid, error: err.message });
          sessionOutcome = 'error';
          targetWs.terminate();
        });
        targetWs.on('error', (err) => {
          logger.error('proxy_ws_target_error', { requestId, uid, error: err.message });
          sessionOutcome = 'error';
          clientWs.terminate();
        });
      });
    }
  });
}
