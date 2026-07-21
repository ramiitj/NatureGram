/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import cors from 'cors';
import fs from 'fs';
import crypto from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath, parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pure Node.js fallback for verifying Firebase ID tokens without relying on internal credentials/ADC project mismatches
let publicKeysCache = null;
let cacheExpiry = 0;

async function fetchPublicKeys() {
  const now = Date.now();
  if (publicKeysCache && now < cacheExpiry) {
    return publicKeysCache;
  }
  return new Promise((resolve, reject) => {
    https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          publicKeysCache = JSON.parse(data);
          const cacheControl = res.headers['cache-control'];
          let maxAge = 3600;
          if (cacheControl) {
             const match = cacheControl.match(/max-age=(\d+)/);
             if (match) maxAge = parseInt(match[1], 10);
          }
          cacheExpiry = Date.now() + maxAge * 1000;
          resolve(publicKeysCache);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Escapes a value for safe interpolation into HTML text/attribute contexts.
// Used on the /s/:postId share-preview route, which embeds Firestore-sourced
// (i.e. user-controlled) post fields directly into a server-rendered page.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeBase64Url(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

async function verifyFirebaseTokenFallback(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerStr, payloadStr, signatureStr] = parts;
  const header = JSON.parse(decodeBase64Url(headerStr));
  const payload = JSON.parse(decodeBase64Url(payloadStr));

  if (header.alg !== 'RS256') {
    throw new Error('Invalid algorithm: expected RS256');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error(`Invalid issuer: got ${payload.iss}, expected https://securetoken.google.com/${projectId}`);
  }
  if (payload.aud !== projectId) {
    throw new Error(`Invalid audience: got ${payload.aud}, expected ${projectId}`);
  }
  if (payload.exp < now) {
    throw new Error(`Token expired. Exp: ${payload.exp}, current: ${now}`);
  }

  const publicKeys = await fetchPublicKeys();
  const cert = publicKeys[header.kid];
  if (!cert) {
    throw new Error(`Public key not found for kid: ${header.kid}`);
  }

  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(`${headerStr}.${payloadStr}`);
  
  const signatureBase64 = signatureStr.replace(/-/g, '+').replace(/_/g, '/');
  const signature = Buffer.from(signatureBase64, 'base64');
  
  const isValid = verify.verify(cert, signature);
  if (!isValid) {
    throw new Error('Signature verification failed');
  }

  return payload;
}

// Verifies a Firebase ID token via firebase-admin, falling back to the pure
// Node.js verifier above if admin credentials/ADC aren't usable in this
// environment. Returns the verified uid, or throws.
async function verifyRequestToken(token, projectIdForFallback) {
  if (!token) {
    throw new Error('No token provided');
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken.uid;
  } catch (e) {
    const decodedFallback = await verifyFirebaseTokenFallback(token, projectIdForFallback);
    return decodedFallback.sub;
  }
}

// Read config to initialize Firebase Admin
let currentFirebaseProjectId = null;
try {
  const firebaseConfigPath = path.join(__dirname, '..', 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    currentFirebaseProjectId = firebaseConfig.projectId;
    admin.initializeApp({ projectId: firebaseConfig.projectId });
    console.log('Firebase Admin initialized with project ID:', firebaseConfig.projectId);
  } else {
    admin.initializeApp();
    console.log('Firebase Admin initialized with default credentials');
  }
} catch (e) {
  console.error("Failed to initialize Firebase Admin:", e);
}

// In-memory session tracking
const userSessions = new Map(); // uid -> { date: string, count: number }
const activeConnections = new Map(); // uid -> Set<WebSocket>

const TARGET_HOST = 'generativelanguage.googleapis.com';

async function startServer() {
  const app = express();
  const PORT = 3000;
  const API_KEY = process.env.GEMINI_API_KEY;
  console.log('Server starting. GEMINI_API_KEY configured:', !!API_KEY);

  // Trust proxy for rate limiting behind Cloud Run/Nginx
  app.set('trust proxy', 1);

  // Allow standard CORS to support iframe preview environments correctly
  app.use(cors());

  // Media Proxy to bypass CORS from Firebase Storage.
  // Restricted to a fixed allowlist of hostnames we actually serve media
  // from, to prevent this from being used as an open SSRF relay (e.g.
  // against the Cloud Run metadata server or internal services).
  const MEDIA_PROXY_ALLOWED_HOSTS = new Set([
    'firebasestorage.googleapis.com',
    'images.unsplash.com',
    'upload.wikimedia.org',
  ]);

  app.get('/api/media-proxy', async (req, res) => {
    try {
      const targetUrl = req.query.url;
      if (!targetUrl || typeof targetUrl !== 'string') {
        return res.status(400).json({ error: 'URL parameter is required' });
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(targetUrl);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid URL' });
      }

      if (parsedUrl.protocol !== 'https:' || !MEDIA_PROXY_ALLOWED_HOSTS.has(parsedUrl.hostname)) {
        return res.status(403).json({ error: 'Host not allowed' });
      }

      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch media' });
      }
      
      res.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
      res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
      
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (e) {
      console.error('[Media Proxy Error]', e);
      res.status(500).json({ error: 'Internal server error while fetching media' });
    }
  });

  // Rate limiter for proxy route
  const apiProxyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

  // Dynamic Social Sharing Route (Works in both Dev and Prod)
  app.get('/s/:postId', async (req, res) => {
    const postId = req.params.postId;

    // Robustly construct site and app URLs, avoiding pointing users to localhost under reverse proxies
    const rawHost = req.headers['x-forwarded-host'] || req.headers['x-forwarded-server'] || req.get('host') || 'thenaturegram.com';
    const isLocalhost = rawHost.includes('localhost') || rawHost.includes('127.0.0.1');
    const resolvedHost = (isLocalhost && process.env.NODE_ENV === 'production') ? 'thenaturegram.com' : rawHost;
    
    const siteUrl = `https://${resolvedHost}/s/${postId}`;
    const appUrl = `https://${resolvedHost}/?post=${postId}`;

    // Detect if this is a web scraping crawler/social bot or a real user browser
    const userAgent = req.headers['user-agent'] || '';
    const isCrawler = /bot|googlebot|crawler|spider|robot|crawling|facebook|twitter|instagram|whatsapp|telegram|discord|slack|linkedin/i.test(userAgent);

    // If it's a real user browser (not a crawler), redirect them immediately via HTTP 302
    if (!isCrawler) {
      return res.redirect(302, appUrl);
    }

    let firebaseApiKey = "AIzaSyBXq7Oxg8se5PVW-vWDlKK9NV81CFpIfYY"; // Public Firebase Key Fallback
    let projectID = "biostream-6490a";
    let databaseID = "(default)";
    
    try {
      const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        projectID = config.projectId || projectID;
        firebaseApiKey = config.apiKey || firebaseApiKey;
        databaseID = config.firestoreDatabaseId || databaseID;
      }
    } catch (e) {
      console.error("Failed to load Firebase config in server sharing route:", e);
    }
    
    try {
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectID}/databases/${databaseID}/documents/ecosystem_feed/${postId}?key=${firebaseApiKey}`;
      const fsResponse = await fetch(firestoreUrl);
      
      if (!fsResponse.ok) throw new Error('Post not found');
      const data = await fsResponse.json();
      
      const fields = data.fields;
      // Handle potential variations in document structure
      const items = fields.items?.arrayValue?.values || [];
      const mainItem = items.length > 0 ? items[0].mapValue.fields : fields;
      
      const labels = mainItem.labels?.arrayValue?.values?.map(v => v.stringValue) || [];
      const commonName = labels.length > 0 ? labels[0] : 'Nature';
      const scientificName = labels.length > 1 ? `(${labels[1]})` : '';
      
      const title = fields.title?.stringValue || `NatureGram Discovery: ${commonName} ${scientificName}`.trim();
      
      const aiInsight = mainItem.aiInsight?.stringValue;
      const description = fields.description?.stringValue || aiInsight || mainItem.description?.stringValue || 'A new nature discovery on NatureGram.';
      
      const imageUrl = fields.thumbnailUrl?.stringValue || fields.imageUrl?.stringValue || mainItem.thumbnailUrl?.stringValue || mainItem.imageUrl?.stringValue || 'https://naturegram.app/og-default.jpg';

      const tags = fields.tags?.arrayValue?.values?.map(v => v.stringValue) ||
                   mainItem.tags?.arrayValue?.values?.map(v => v.stringValue) ||
                   [];

      // Everything above is sourced from Firestore post fields, which are
      // user-controlled (any signed-in user can create/edit a post). Escape
      // it all before interpolating into the response HTML to prevent
      // stored XSS against anyone (including bots/crawlers) loading this
      // share-preview page.
      const safeTitle = escapeHtml(title);
      const safeDescription = escapeHtml(description);
      const safeImageUrl = escapeHtml(imageUrl);
      const safeSiteUrl = escapeHtml(siteUrl);
      const safeAppUrl = escapeHtml(appUrl);
      const safeTags = tags.map(tag => escapeHtml(tag.startsWith('#') ? tag : '#' + tag));

      // Return a specialized preview HTML page featuring the thumbnail, tags, and hyperlink
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <meta name="title" content="${safeTitle}">
    <meta name="description" content="${safeDescription}">

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${safeSiteUrl}">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:image" content="${safeImageUrl}">

    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${safeSiteUrl}">
    <meta property="twitter:title" content="${safeTitle}">
    <meta property="twitter:description" content="${safeDescription}">
    <meta property="twitter:image" content="${safeImageUrl}">

    <!-- UI & Fonts imports -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      // Browser-side absolute fallback to ensure instant redirect for humans even if backend crawler detection was bypassed
      window.location.replace("${safeAppUrl}");

      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              sans: ['Inter', 'sans-serif'],
              display: ['Space Grotesk', 'sans-serif'],
            }
          }
        }
      }
    </script>
</head>
<body class="bg-[#faf9f6] text-stone-900 font-sans flex flex-col items-center justify-center min-h-screen p-4 md:p-6 select-none">
    <div class="max-w-md w-full bg-white rounded-3xl overflow-hidden shadow-2xl border border-stone-200/50 flex flex-col p-6 gap-6 transition-all transform hover:scale-[1.01] hover:shadow-emerald-950/5 animate-fade-in">

        <!-- NatureGram Brand -->
        <div class="flex items-center justify-between pb-3 border-b border-stone-100 shrink-0">
            <h1 class="text-xl font-bold font-display italic tracking-tight text-emerald-800">NatureGram</h1>
            <div class="flex items-center gap-1.5 opacity-60">
                <span class="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></span>
                <p class="text-[9px] font-mono font-bold tracking-widest uppercase">Shared post</p>
            </div>
        </div>

        <!-- Thumbnail link (Clickable to view full post) -->
        <a href="${safeAppUrl}" id="shared_post_thumbnail" class="block group relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-stone-100 border border-stone-200">
            <img src="${safeImageUrl}"
                 alt="${safeTitle}"
                 referrerpolicy="no-referrer"
                 class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <!-- Hover Overlay -->
            <div class="absolute inset-0 bg-stone-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="px-4 py-2 rounded-full bg-white/95 shadow-lg text-[10px] font-black text-stone-900 uppercase tracking-widest flex items-center gap-1">
                    Launch in app
                    <span class="material-symbols-outlined text-[10px]">open_in_new</span>
                </div>
            </div>
        </a>

        <!-- Content Info -->
        <div class="space-y-3">
            <div class="flex flex-wrap gap-1.5">
                ${safeTags.length > 0
                  ? safeTags.map(tag => `
                    <span class="px-2.5 py-1 bg-emerald-50 border border-emerald-100/60 text-emerald-800 text-[9px] uppercase font-black tracking-widest rounded-md">
                        ${tag}
                    </span>
                  `).join('')
                  : `<span class="px-2.5 py-1 bg-emerald-50 border border-emerald-100/60 text-emerald-800 text-[9px] uppercase font-black tracking-widest rounded-md">#NATURE</span>`
                }
            </div>

            <h2 class="text-xl font-bold font-display tracking-tight text-stone-900 leading-snug">
                ${safeTitle}
            </h2>

            <p class="text-stone-600/90 text-xs leading-relaxed line-clamp-3">
                ${safeDescription}
            </p>
        </div>

        <!-- Call to Action (Hyperlink to view full post directly) -->
        <a href="${safeAppUrl}" id="shared_post_btn" class="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 px-6 rounded-2xl font-bold shadow-lg shadow-emerald-700/10 active:scale-95 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] tracking-wider text-center">
            <span>Directly View Full Post</span>
            <span class="material-symbols-outlined text-sm font-black animate-pulse">arrow_forward</span>
        </a>
    </div>
</body>
</html>`;
      res.send(html);
    } catch (e) {
      console.error("Error fetching post for OG tags:", e);
      // Fallback redirect for users to main app page
      res.redirect(302, appUrl);
    }
  });

  // HTTP Proxy for Gemini API.
  // Requires a verified Firebase ID token (same scheme as the WebSocket
  // proxy below) so this can't be used as a free, unauthenticated relay
  // for the Gemini API key.
  app.use('/api-proxy', cors(), apiProxyLimiter, async (req, res) => {
    if (!API_KEY) {
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
      uid = await verifyRequestToken(token, currentFirebaseProjectId || 'biostream-6490a');
    } catch (e) {
      console.warn('[Proxy] HTTP auth failed:', e.message);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Only now swap in the real key, once the caller is verified.
    url.searchParams.set('key', API_KEY);
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
        'x-goog-api-key': API_KEY,
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

  const server = http.createServer(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: { server }
      },
      appType: 'spa',
      root: path.join(__dirname, '..')
    });
    app.use(vite.middlewares);
  } else {
    // Serve static frontend in production
    const staticPath = path.join(__dirname, '..', 'dist');
    app.use(express.static(staticPath));
    
    // Final fallback for SPA
    app.get('*all', (req, res) => {
        res.sendFile(path.join(staticPath, 'index.html'));
    });
  }

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
             uid = await verifyRequestToken(token, currentFirebaseProjectId || 'biostream-6490a');
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

          if (!API_KEY) {
            console.error('[Proxy] WS Upgrade failed: GEMINI_API_KEY not configured');
            clientWs.close();
            return;
          }
          const targetPathname = url.pathname;
          url.searchParams.set('key', API_KEY);
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

  server.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port', PORT);
    console.log('WebSocket proxy enabled for /api-proxy -> generativelanguage.googleapis.com');
  });
}

startServer();
