/**
 * NatureGram server
 *  - Serves the SPA (Vite middleware in dev, static dist in prod)
 *  - Authenticated, quota-governed proxy to the Gemini API (HTTP + Live WebSocket)
 *  - Allow-listed media proxy (CORS helper for Firebase Storage / theme imagery)
 *  - Server-rendered share previews for social crawlers (/s/:postId)
 *
 * Security notes:
 *  - Never log secrets, tokens or request/response payloads.
 *  - All user-controlled values rendered into HTML are escaped.
 */

import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import admin from 'firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { governLiveSetup, governGenerateRequest, governGenerateBody, AI_POLICY_VERSION } from './aiGovernance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Structured logging (no payloads, no secrets)
// ---------------------------------------------------------------------------
const log = (level, msg, meta = {}) => {
  const line = JSON.stringify({ severity: level.toUpperCase(), time: new Date().toISOString(), msg, ...meta });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEY = process.env.GEMINI_API_KEY || '';
const TARGET_HOST = 'generativelanguage.googleapis.com';
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'thenaturegram.com';

const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
const QUOTAS = {
  user: {
    httpPerDay: num(process.env.QUOTA_USER_HTTP_PER_DAY, 300),
    liveMsPerDay: num(process.env.QUOTA_USER_LIVE_MIN_PER_DAY, 90) * 60_000,
  },
  anonymous: {
    httpPerDay: num(process.env.QUOTA_ANON_HTTP_PER_DAY, 40),
    liveMsPerDay: num(process.env.QUOTA_ANON_LIVE_MIN_PER_DAY, 20) * 60_000,
  },
  httpPerMinute: num(process.env.QUOTA_HTTP_PER_MIN, 20),
  maxConcurrentLive: num(process.env.QUOTA_MAX_CONCURRENT_LIVE, 2),
  liveSessionMaxMs: num(process.env.LIVE_SESSION_MAX_MIN, 15) * 60_000,
  maxBodyBytes: num(process.env.MAX_PROXY_BODY_MB, 25) * 1024 * 1024,
};

const DEFAULT_ALLOWED_ORIGINS = [
  `https://${PUBLIC_HOST}`,
  `https://www.${PUBLIC_HOST}`,
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
];
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
]);
const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    // AI Studio / Cloud Run preview environments
    if (u.protocol === 'https:' && u.hostname.endsWith('.run.app')) return true;
  } catch { /* ignore */ }
  return false;
};

// Hosts the media proxy may fetch from (CORS helper only)
const MEDIA_PROXY_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com',
  'images.unsplash.com',
  'upload.wikimedia.org',
]);

// ---------------------------------------------------------------------------
// Firebase Admin + token verification
// ---------------------------------------------------------------------------
let firebaseProjectId = 'biostream-6490a';
let firebaseWebConfig = null;
try {
  const cfgPath = path.join(ROOT_DIR, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    firebaseWebConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    firebaseProjectId = firebaseWebConfig.projectId || firebaseProjectId;
  }
  admin.initializeApp({ projectId: firebaseProjectId });
  log('info', 'Firebase Admin initialized', { projectId: firebaseProjectId });
} catch (e) {
  log('error', 'Failed to initialize Firebase Admin', { error: e.message });
}

let publicKeysCache = null;
let cacheExpiry = 0;
function fetchPublicKeys() {
  if (publicKeysCache && Date.now() < cacheExpiry) return Promise.resolve(publicKeysCache);
  return new Promise((resolve, reject) => {
    https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          publicKeysCache = JSON.parse(data);
          const m = (res.headers['cache-control'] || '').match(/max-age=(\d+)/);
          cacheExpiry = Date.now() + (m ? parseInt(m[1], 10) : 3600) * 1000;
          resolve(publicKeysCache);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
const b64urlJson = (s) => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

// Pure Node fallback (used when ADC belongs to a different GCP project than Firebase)
async function verifyTokenFallback(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const [h, p, s] = parts;
  const header = b64urlJson(h);
  const payload = b64urlJson(p);
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256') throw new Error('Invalid alg');
  if (payload.iss !== `https://securetoken.google.com/${firebaseProjectId}`) throw new Error('Invalid issuer');
  if (payload.aud !== firebaseProjectId) throw new Error('Invalid audience');
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('Token expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('Invalid iat');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Invalid sub');
  const keys = await fetchPublicKeys();
  const cert = keys[header.kid];
  if (!cert) throw new Error('Unknown key id');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${h}.${p}`);
  if (!verifier.verify(cert, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))) {
    throw new Error('Bad signature');
  }
  return { ...payload, uid: payload.sub };
}

async function verifyIdToken(token) {
  if (!token || token === 'PROXY' || token.length > 4096) throw new Error('Missing token');
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    decoded = await verifyTokenFallback(token);
  }
  const provider = decoded.firebase?.sign_in_provider || 'unknown';
  return { uid: decoded.uid || decoded.sub, isAnonymous: provider === 'anonymous', provider };
}

// ---------------------------------------------------------------------------
// Per-user quota ledger (per instance; set QUOTA_* env vars to tune)
// ---------------------------------------------------------------------------
const ledger = new Map(); // uid -> { day, http, liveMs, minuteWindow, minuteCount }
const activeLive = new Map(); // uid -> Set<{ startedAt }>
const today = () => new Date().toISOString().slice(0, 10);
function entry(uid) {
  let e = ledger.get(uid);
  if (!e || e.day !== today()) {
    e = { day: today(), http: 0, liveMs: 0, minuteWindow: 0, minuteCount: 0 };
    ledger.set(uid, e);
  }
  return e;
}
setInterval(() => {
  const d = today();
  for (const [uid, e] of ledger) if (e.day !== d && !activeLive.has(uid)) ledger.delete(uid);
}, 60 * 60 * 1000).unref();

function chargeHttp(user) {
  const e = entry(user.uid);
  const q = user.isAnonymous ? QUOTAS.anonymous : QUOTAS.user;
  const minute = Math.floor(Date.now() / 60_000);
  if (e.minuteWindow !== minute) { e.minuteWindow = minute; e.minuteCount = 0; }
  if (e.minuteCount >= QUOTAS.httpPerMinute) return { ok: false, reason: 'Too many requests. Please slow down.' };
  if (e.http >= q.httpPerDay) {
    return { ok: false, reason: user.isAnonymous ? 'Daily AI limit reached for guests. Create a free account for more.' : 'Daily AI limit reached. It resets at midnight UTC.' };
  }
  e.minuteCount++; e.http++;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeHttpsUrl = (v, fallback) => {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' ? u.toString() : fallback;
  } catch { return fallback; }
};
const POST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression());

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com https://cdn.tailwindcss.com https://esm.sh",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "connect-src 'self' wss: https://esm.sh https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://nominatim.openstreetmap.org https://en.wikipedia.org https://*.wikipedia.org",
      "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
      "worker-src 'self' blob:",
      "frame-ancestors 'self' https://aistudio.google.com https://*.google.com",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '));
    next();
  });

  // CORS: only known origins (same-origin requests need no CORS headers)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, x-goog-api-client');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(origin && isAllowedOrigin(origin) ? 204 : 403);
    next();
  });

  // Health check (Cloud Run / load balancers)
  app.get('/healthz', (req, res) => res.json({ ok: true, policy: AI_POLICY_VERSION }));

  // -------------------------------------------------------------------------
  // Media proxy (allow-listed hosts only, image/video/audio only, size-capped)
  // -------------------------------------------------------------------------
  const mediaLimiter = rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false });
  app.get('/api/media-proxy', mediaLimiter, async (req, res) => {
    const raw = req.query.url;
    if (!raw || typeof raw !== 'string' || raw.length > 4096) return res.status(400).json({ error: 'url is required' });
    let target;
    try { target = new URL(raw); } catch { return res.status(400).json({ error: 'Invalid url' }); }
    if (target.protocol !== 'https:' || !MEDIA_PROXY_HOSTS.has(target.hostname)) {
      return res.status(403).json({ error: 'Host not allowed' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const upstream = await fetch(target, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'NatureGramMediaProxy/1.0', Accept: 'image/*,video/*,audio/*' },
      });
      const finalHost = new URL(upstream.url).hostname;
      if (!MEDIA_PROXY_HOSTS.has(finalHost)) return res.status(403).json({ error: 'Redirect host not allowed' });
      if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).json({ error: 'Failed to fetch media' });
      const type = (upstream.headers.get('content-type') || '').toLowerCase();
      if (!/^(image|video|audio)\//.test(type) || type.includes('svg')) {
        return res.status(415).json({ error: 'Unsupported media type' });
      }
      const len = Number(upstream.headers.get('content-length') || 0);
      const MAX = 40 * 1024 * 1024;
      if (len > MAX) return res.status(413).json({ error: 'Media too large' });
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Disposition', 'inline');
      if (len) res.setHeader('Content-Length', String(len));
      let sent = 0;
      for await (const chunk of upstream.body) {
        sent += chunk.length;
        if (sent > MAX) { res.destroy(); return; }
        if (!res.write(chunk)) await new Promise(r => res.once('drain', r));
      }
      res.end();
    } catch (e) {
      log('warn', 'media proxy failed', { host: target.hostname, error: e.name });
      if (!res.headersSent) res.status(502).json({ error: 'Failed to fetch media' });
    } finally {
      clearTimeout(timer);
    }
  });

  // -------------------------------------------------------------------------
  // Share previews for social crawlers
  // -------------------------------------------------------------------------
  app.get('/s/:postId', async (req, res) => {
    const postId = String(req.params.postId || '');
    const host = IS_PROD ? PUBLIC_HOST : (req.get('host') || PUBLIC_HOST);
    const scheme = IS_PROD || !/^(localhost|127\.0\.0\.1)/.test(host) ? 'https' : 'http';
    if (!POST_ID_RE.test(postId)) return res.redirect(302, '/');

    const siteUrl = `${scheme}://${host}/s/${postId}`;
    const appUrl = `${scheme}://${host}/?post=${encodeURIComponent(postId)}`;
    const ua = req.headers['user-agent'] || '';
    const isCrawler = /bot|crawler|spider|crawling|facebookexternalhit|twitterbot|whatsapp|telegram|discord|slack|linkedin|embedly|pinterest/i.test(ua);
    if (!isCrawler) return res.redirect(302, appUrl);

    const apiKey = firebaseWebConfig?.apiKey;
    const databaseId = firebaseWebConfig?.firestoreDatabaseId || '(default)';
    let title = 'NatureGram: a living field guide';
    let description = 'Nature discoveries shared by explorers on NatureGram.';
    let imageUrl = `https://${PUBLIC_HOST}/og-default.jpg`;
    let tags = [];
    try {
      if (!apiKey) throw new Error('No Firebase config');
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseProjectId)}/databases/${encodeURIComponent(databaseId)}/documents/ecosystem_feed/${postId}?key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('Post not found');
      const f = (await r.json()).fields || {};
      if (f.isPublic?.booleanValue === true) {
        const items = f.items?.arrayValue?.values || [];
        const main = items.length ? (items[0].mapValue?.fields || {}) : f;
        const labels = (main.labels?.arrayValue?.values || f.labels?.arrayValue?.values || []).map(v => v.stringValue).filter(Boolean);
        const common = labels[0] || 'Nature';
        title = f.caption?.stringValue || f.title?.stringValue || `NatureGram discovery: ${common}${labels[1] ? ` (${labels[1]})` : ''}`;
        description = f.description?.stringValue || main.aiInsight?.stringValue || f.aiInsight?.stringValue || description;
        imageUrl = safeHttpsUrl(f.thumbnailUrl?.stringValue || f.imageUrl?.stringValue || main.thumbnailUrl?.stringValue || main.imageUrl?.stringValue, imageUrl);
        tags = (f.tags?.arrayValue?.values || []).map(v => v.stringValue).filter(Boolean).slice(0, 8);
      }
    } catch (e) {
      log('warn', 'share preview fallback', { postId, error: e.message });
    }
    title = title.slice(0, 140);
    description = description.slice(0, 300);

    const e = escapeHtml;
    const tagHtml = (tags.length ? tags : ['#nature']).map(t => {
      const clean = String(t).replace(/^#+/, '');
      return `<span class="tag">#${e(clean)}</span>`;
    }).join('');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<link rel="canonical" href="${e(siteUrl)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="NatureGram">
<meta property="og:url" content="${e(siteUrl)}"><meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}"><meta property="og:image" content="${e(imageUrl)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}"><meta name="twitter:image" content="${e(imageUrl)}">
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf9f6;color:#1c1917;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
.card{max-width:420px;width:100%;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.08);padding:20px}
h1{font-size:18px;color:#065f46;margin:0 0 12px}img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:16px;background:#eee}
h2{font-size:20px;margin:14px 0 6px}p{font-size:14px;line-height:1.5;color:#57534e}.tag{display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:8px;background:#ecfdf5;color:#065f46;font-size:12px;font-weight:700}
a.btn{display:block;text-align:center;margin-top:16px;padding:14px;border-radius:14px;background:#047857;color:#fff;text-decoration:none;font-weight:700}
</style></head>
<body><main class="card">
<h1>NatureGram</h1>
<a href="${e(appUrl)}"><img src="${e(imageUrl)}" alt="${e(title)}" referrerpolicy="no-referrer"></a>
<div>${tagHtml}</div>
<h2>${e(title)}</h2>
<p>${e(description)}</p>
<a class="btn" href="${e(appUrl)}">View on NatureGram</a>
</main></body></html>`);
  });

  // -------------------------------------------------------------------------
  // Gemini HTTP proxy: authenticated, allow-listed, quota-governed
  // -------------------------------------------------------------------------
  const ipLimiter = rateLimit({ windowMs: 15 * 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
  app.use('/api-proxy', ipLimiter, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    let url;
    try { url = new URL(req.url, `https://${TARGET_HOST}`); } catch { return res.status(400).json({ error: 'Bad request' }); }

    const authHeader = req.headers.authorization || '';
    const token = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) || url.searchParams.get('key') || req.headers['x-goog-api-key'];
    let user;
    try {
      user = await verifyIdToken(String(token || ''));
    } catch {
      return res.status(401).json({ error: { code: 401, message: 'Please sign in again.' } });
    }

    // Endpoint + model governance
    const verdict = governGenerateRequest(url.pathname);
    if (!verdict.ok) {
      log('warn', 'blocked gemini path', { uid: user.uid, reason: verdict.reason });
      return res.status(403).json({ error: { code: 403, message: verdict.reason } });
    }
    const len = Number(req.headers['content-length'] || 0);
    if (len > QUOTAS.maxBodyBytes) return res.status(413).json({ error: { code: 413, message: 'Media too large to analyze.' } });

    const charge = chargeHttp(user);
    if (!charge.ok) return res.status(429).json({ error: { code: 429, message: charge.reason } });
    if (!API_KEY) return res.status(503).json({ error: { code: 503, message: 'AI is not configured on the server.' } });

    // Read the (size-capped) body so the governance layer can apply policy + safety settings
    let raw;
    try {
      raw = await new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        req.on('data', (c) => {
          bytes += c.length;
          if (bytes > QUOTAS.maxBodyBytes) { reject(new Error('too_large')); req.destroy(); return; }
          chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
    } catch (e) {
      return res.status(e.message === 'too_large' ? 413 : 400).json({ error: { code: 413, message: 'Media too large to analyze.' } });
    }
    let payload = raw;
    if (verdict.method !== 'countTokens') {
      try {
        payload = Buffer.from(JSON.stringify(governGenerateBody(JSON.parse(raw.toString('utf8') || '{}'), verdict.model)));
      } catch {
        return res.status(400).json({ error: { code: 400, message: 'Invalid request body.' } });
      }
    }

    const outParams = new URLSearchParams();
    for (const [k, v] of url.searchParams) if (k === 'alt') outParams.set(k, v);
    const targetPath = verdict.path + (outParams.toString() ? `?${outParams}` : '');
    const started = Date.now();
    const proxyReq = https.request({
      hostname: TARGET_HOST,
      port: 443,
      path: targetPath,
      method: 'POST',
      timeout: 120_000,
      headers: {
        host: TARGET_HOST,
        'content-type': 'application/json',
        'content-length': String(payload.length),
        ...(req.headers['x-goog-api-client'] ? { 'x-goog-api-client': req.headers['x-goog-api-client'] } : {}),
        origin: `https://${PUBLIC_HOST}`,
        referer: `https://${PUBLIC_HOST}/`,
        'x-goog-api-key': API_KEY,
      },
    }, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      delete headers['set-cookie'];
      res.writeHead(proxyRes.statusCode || 502, headers);
      proxyRes.pipe(res);
      proxyRes.on('end', () => log('info', 'gemini http', { uid: user.uid, anon: user.isAnonymous, model: verdict.model, method: verdict.method, status: proxyRes.statusCode, ms: Date.now() - started }));
    });
    proxyReq.on('timeout', () => proxyReq.destroy(new Error('timeout')));
    proxyReq.on('error', (err) => {
      log('error', 'gemini http proxy error', { uid: user.uid, error: err.message });
      if (!res.headersSent) res.status(502).json({ error: { code: 502, message: 'AI service unavailable. Please retry.' } });
    });
    proxyReq.end(payload);
  });

  // -------------------------------------------------------------------------
  // Frontend
  // -------------------------------------------------------------------------
  const server = http.createServer(app);
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa', root: ROOT_DIR });
    app.use(vite.middlewares);
  } else {
    const staticPath = path.join(ROOT_DIR, 'dist');
    app.use('/assets', express.static(path.join(staticPath, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(staticPath, {
      index: false,
      setHeaders: (res, p) => { if (p.endsWith('.html') || p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); },
    }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(staticPath, 'index.html'));
    });
  }

  // -------------------------------------------------------------------------
  // Gemini Live WebSocket proxy
  // -------------------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  server.on('upgrade', async (req, socket, head) => {
    let reqUrl;
    try { reqUrl = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (!reqUrl.pathname.startsWith('/api-proxy')) return; // Vite HMR etc.
    if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    const relPath = reqUrl.pathname.replace(/^\/api-proxy\/*/, '/');
    if (!/bidigeneratecontent/i.test(relPath) || relPath.includes('..')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    let user;
    try {
      user = await verifyIdToken(reqUrl.searchParams.get('access_token') || reqUrl.searchParams.get('key') || '');
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const closeWith = (code, reason) => { try { clientWs.close(code, reason); } catch { /* noop */ } };
      const q = user.isAnonymous ? QUOTAS.anonymous : QUOTAS.user;
      const e = entry(user.uid);
      const conns = activeLive.get(user.uid) || new Set();
      if (conns.size >= QUOTAS.maxConcurrentLive) return closeWith(4429, 'Too many live sessions open. Close other tabs and retry.');
      if (e.liveMs >= q.liveMsPerDay) {
        return closeWith(4429, user.isAnonymous ? 'Daily live guide limit reached for guests. Create a free account for more.' : 'Daily live guide limit reached. It resets at midnight UTC.');
      }
      if (!API_KEY) return closeWith(1011, 'AI is not configured on the server.');

      const session = { startedAt: Date.now() };
      conns.add(session);
      activeLive.set(user.uid, conns);
      const remaining = Math.min(QUOTAS.liveSessionMaxMs, q.liveMsPerDay - e.liveMs);
      const timeout = setTimeout(() => closeWith(4408, 'Live session time limit reached. Start a new session to continue.'), remaining);

      const target = new WebSocket(`wss://${TARGET_HOST}${relPath}?key=${encodeURIComponent(API_KEY)}`, { headers: { host: TARGET_HOST } });
      const queue = [];
      let targetOpen = false;
      let setupSeen = false;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        e.liveMs += Date.now() - session.startedAt;
        conns.delete(session);
        if (!conns.size) activeLive.delete(user.uid);
        log('info', 'live session ended', { uid: user.uid, anon: user.isAnonymous, ms: Date.now() - session.startedAt });
      };
      log('info', 'live session started', { uid: user.uid, anon: user.isAnonymous });

      const forward = (data, isBinary) => {
        // Govern the first (setup) frame: pin model + inject AI policy
        if (!setupSeen) {
          setupSeen = true;
          try {
            const msg = JSON.parse(isBinary ? Buffer.from(data).toString('utf8') : data.toString());
            const governed = governLiveSetup(msg, { isAnonymous: user.isAnonymous });
            data = Buffer.from(JSON.stringify(governed));
            isBinary = false;
          } catch {
            return closeWith(1008, 'Invalid session setup');
          }
        }
        if (targetOpen) target.send(data, { binary: isBinary });
        else if (queue.length < 64) queue.push({ data, isBinary });
        else closeWith(1013, 'Connection busy, retry');
      };

      target.on('open', () => {
        targetOpen = true;
        while (queue.length) { const m = queue.shift(); target.send(m.data, { binary: m.isBinary }); }
      });
      clientWs.on('message', forward);
      target.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary });
      });
      target.on('close', (code, reason) => {
        finish();
        const safe = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1011;
        closeWith(safe, reason?.toString().slice(0, 120));
      });
      target.on('error', (err) => { log('error', 'live upstream error', { uid: user.uid, error: err.message }); finish(); try { clientWs.terminate(); } catch { /* noop */ } });
      clientWs.on('close', (code) => {
        finish();
        const safe = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1000;
        try { if (target.readyState === WebSocket.OPEN) target.close(safe); else target.terminate(); } catch { /* noop */ }
      });
      clientWs.on('error', () => { finish(); try { target.terminate(); } catch { /* noop */ } });
    });
  });

  server.listen(PORT, '0.0.0.0', () => log('info', 'server listening', { port: PORT, prod: IS_PROD, aiConfigured: Boolean(API_KEY) }));

  const shutdown = (signal) => {
    log('info', 'shutting down', { signal });
    for (const c of wss.clients) { try { c.close(1012, 'Server restarting, please reconnect'); } catch { /* noop */ } }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((e) => { log('error', 'fatal startup error', { error: e.message }); process.exit(1); });
