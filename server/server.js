/**
 * NatureGram server
 *  - Serves the SPA (Vite middleware in dev, static dist in prod)
 *  - Authenticated, quota-governed proxy to the Gemini API (HTTP + Live WebSocket)
 *  - Allow-listed media proxy (CORS helper for Firebase Storage / theme imagery)
 *  - Server-rendered share previews for social crawlers (/s/:postId)
 *  - Crawlable public pages, structured data, robots.txt, sitemaps and llms.txt (seoRoutes.js)
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
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { governLiveSetup, governGenerateRequest, governGenerateBody, modelFor, findPolicyBreach, allowedLiveMessage, AI_POLICY_VERSION } from './aiGovernance.js';
import { initSettings, getFlags, getSettings, ipBlocked } from './settings.js';
import { initLedger, charge, record, usageFor, globalTokensToday, addGlobalTokens, logAi, isSuspended, storeHealth, RESET_WORDS, nextReset } from './ledger.js';
import { mountPublish } from './publish.js';
import { mountAdmin } from './admin.js';
import { initLeases, acquire as acquireLease, hold as holdLease, leaseHealth } from './liveLeases.js';
import { appCheckVerdict, appCheckStats, splitWsAppCheck } from './appCheck.js';
import { mountLive, LIVE_DIRECT_TOKENS } from './liveTokens.js';
import { mountAuthMail } from './authMail.js';
import { mountGuardian } from './guardian.js';
import { mountSeo, canonicalHost } from './seoRoutes.js';
import { leadName } from './seo.js';
import { mountBrandIcons, naturalistAt } from './brandIcon.js';
import { mountNaturalistWiki } from './naturalistWiki.js';
import { mountAccountDeletion } from './accountDeletion.js';
import { getStorage } from 'firebase-admin/storage';
import { feedFirstPost, firstTilesJson } from './media.js';

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
  // Daily allowances and caps are admin settings (server/settings.js). These are technical limits.
  httpPerMinute: num(process.env.QUOTA_HTTP_PER_MIN, 20),
  maxConcurrentLive: num(process.env.QUOTA_MAX_CONCURRENT_LIVE, 1),
  // All explorers together, across every server instance (shared leases); 0 = no global cap
  maxConcurrentLiveGlobal: num(process.env.LIVE_GLOBAL_MAX_CONCURRENT, 0),
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
  // FIREBASE_SERVICE_ACCOUNT (JSON) is used when the server runs outside the Firebase project's
  // Google Cloud project; otherwise the runtime's own service account is used.
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : null;
  admin.initializeApp(sa ? { credential: admin.credential.cert(sa), projectId: firebaseProjectId } : { projectId: firebaseProjectId });
  log('info', 'Firebase Admin initialized', { projectId: firebaseProjectId });
} catch (e) {
  log('error', 'Failed to initialize Firebase Admin', { error: e.message });
}

// Shared store for settings, allowances, logs and moderation (Admin SDK)
let firestoreDb = null;
try {
  firestoreDb = getFirestore();
  if (firebaseWebConfig?.firestoreDatabaseId && firebaseWebConfig.firestoreDatabaseId !== '(default)') {
    firestoreDb = getFirestore(admin.app(), firebaseWebConfig.firestoreDatabaseId);
  }
  firestoreDb.settings({ ignoreUndefinedProperties: true });
} catch (e) { log('warn', 'shared store not initialised', { error: e.message }); }
initSettings(firestoreDb);
initLedger(firestoreDb);
initLeases(firestoreDb);

// One stray error must never take the whole server down
process.on('unhandledRejection', (e) => log('error', 'unhandled rejection', { error: String(e?.message || e).slice(0, 300) }));
process.on('uncaughtException', (e) => log('error', 'uncaught exception', { error: String(e?.message || e).slice(0, 300) }));

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
  return {
    uid: decoded.uid || decoded.sub, isAnonymous: provider === 'anonymous', provider,
    email: decoded.email || null, emailVerified: decoded.email_verified === true,
    admin: decoded.admin === true, secondFactor: decoded.firebase?.sign_in_second_factor || null,
    authTime: Number(decoded.auth_time) || 0,
  };
}

// ---------------------------------------------------------------------------
// Gatekeeping: admin switches, suspensions, blocked networks, spending ceiling,
// per-minute bursts (per instance) and daily allowances (shared, fail closed)
// ---------------------------------------------------------------------------
const bursts = new Map(); // uid -> { minute, count }
const activeLive = new Map(); // uid -> Set<{ startedAt }>
const networkLive = new Map(); // ip -> { hour, opened, concurrent }
setInterval(() => {
  const minute = Math.floor(Date.now() / 60_000);
  for (const [k, v] of bursts) if (v.minute < minute - 1) bursts.delete(k);
  const hour = Math.floor(Date.now() / 3_600_000);
  for (const [k, v] of networkLive) if (v.hour < hour && !v.concurrent) networkLive.delete(k);
}, 5 * 60_000).unref();

function burstOk(uid) {
  const minute = Math.floor(Date.now() / 60_000);
  const b = bursts.get(uid);
  if (!b || b.minute !== minute) { bursts.set(uid, { minute, count: 1 }); return true; }
  if (b.count >= QUOTAS.httpPerMinute) return false;
  b.count++;
  return true;
}

/**
 * Checks shared by every AI entry point. Returns null when the request may go ahead,
 * or { status, message } explaining why not.
 */
async function gate(user, ip, { live = false } = {}) {
  const [flags, settings] = await Promise.all([getFlags(), getSettings()]);
  if (ipBlocked(settings, ip)) return { status: 403, message: 'Access from this network has been blocked.' };
  if (await isSuspended(user.uid)) return { status: 403, message: 'This account is suspended.' };
  if (!flags.aiEnabled) return { status: 503, message: 'AI features are paused right now. Please try again later.' };
  if (live && !flags.liveEnabled) return { status: 503, message: 'The live guide is paused right now.' };
  if (user.isAnonymous && !flags.guestsEnabled) return { status: 403, message: 'Create a free account to use the guide.' };
  const ceiling = Number(settings.caps.dailyTokenCeiling) || 0;
  if (ceiling > 0 && (await globalTokensToday()) >= ceiling) return { status: 503, message: 'AI features have reached today\'s limit for everyone. They resume tomorrow.' };
  return null;
}

/** Daily allowance for one AI task, the same for every account. */
async function chargeTask(user, spec) {
  if (!burstOk(user.uid)) return { status: 429, message: 'Too many requests. Please slow down.' };
  const [flags, settings] = await Promise.all([getFlags(), getSettings()]);
  const limit = spec.counter === 'identify' ? Number(flags.allowances.identificationsPerDay) : Number(settings.caps.otherAiCallsPerDay);
  const res = await charge(user.uid, spec.counter, 1, Math.max(0, limit || 0));
  if (res.unavailable) return { status: 503, message: 'The guide is unavailable for a moment. Please try again.' };
  if (!res.ok) return { status: 429, message: spec.counter === 'identify' ? `You've used today's ${limit} identifications. They reset ${RESET_WORDS}. You can still name sightings yourself.` : `Daily AI limit reached. It resets ${RESET_WORDS}.` };
  return null;
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
  // One address for search engines: www.thenaturegram.com -> thenaturegram.com
  app.use(canonicalHost(PUBLIC_HOST));
  // Home-screen icons and manifest that follow the mark in the browser tab
  mountBrandIcons(app, { db: () => firestoreDb, log });
  mountNaturalistWiki(app, { db: () => firestoreDb, log });
  (await import('./speciesWiki.js')).mountSpeciesWiki(app, { log });
  // Public pages and discovery files (mounted with the frontend below); /s/ uses it for share cards
  let seo = null;

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self'${IS_PROD ? '' : " 'unsafe-inline'"} https://www.gstatic.com https://apis.google.com https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://www.recaptcha.net`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "connect-src 'self' wss: https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://*.doubleclick.net https://www.google.com https://www.googleadservices.com https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://nominatim.openstreetmap.org https://en.wikipedia.org https://*.wikipedia.org https://*.sentry.io",
      "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://td.doubleclick.net https://www.googletagmanager.com https://www.google.com https://recaptcha.google.com https://www.recaptcha.net",
      "worker-src 'self' blob:",
      "frame-ancestors 'self' https://aistudio.google.com",
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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, x-goog-api-client, X-Firebase-AppCheck');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(origin && isAllowedOrigin(origin) ? 204 : 403);
    next();
  });

  // Health check (Cloud Run / load balancers)
  // Health: also says whether the shared store (allowances, settings, logs) is reachable,
  // because the AI refuses requests when it isn't (limits fail closed).
  let probe = { at: 0, ok: false, error: null };
  // Public, non-secret client settings read at runtime, so they can be changed on Cloud Run without a rebuild
  app.get('/api/client-config', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      appCheckSiteKey: process.env.APPCHECK_SITE_KEY || '',
      appCheckProvider: process.env.APPCHECK_PROVIDER === 'v3' ? 'v3' : 'enterprise',
    });
  });

  // Cloud Run's front end reserves /healthz for itself, so the same check also answers at /api/health
  app.get(['/healthz', '/api/health'], async (req, res) => {
    if (Date.now() - probe.at > 30_000 && firestoreDb) {
      try {
        await Promise.race([firestoreDb.doc('app_config/flags').get(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000))]);
        probe = { at: Date.now(), ok: true, error: null };
      } catch (e) { probe = { at: Date.now(), ok: false, error: String(e.message).slice(0, 120) }; }
    }
    const store = storeHealth();
    const ok = Boolean(firestoreDb && probe.ok && store.ok);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok, policy: AI_POLICY_VERSION, ai: Boolean(API_KEY), store: { connected: Boolean(firestoreDb), reachable: probe.ok, lastError: ok ? null : (probe.error || store.error) } });
  });

  // First-party analytics + client error intake → structured logs (Cloud Logging / BigQuery sink)
  const eventsLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
  const EVENT_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
  app.post('/api/events', eventsLimiter, express.json({ limit: '32kb', type: ['application/json', 'text/plain'] }), (req, res) => {
    const body = req.body || {};
    const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : null;
    const uid = typeof body.uid === 'string' ? body.uid.slice(0, 128) : null;
    const pagePath = typeof body.path === 'string' ? body.path.slice(0, 64) : null;
    for (const e of events) {
      if (!e || typeof e.name !== 'string' || !EVENT_NAME_RE.test(e.name)) continue;
      const props = {};
      if (e.props && typeof e.props === 'object') {
        for (const [k, v] of Object.entries(e.props).slice(0, 20)) {
          if (/^[a-zA-Z0-9_]{1,40}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) props[k] = typeof v === 'string' ? v.slice(0, 200) : v;
        }
      }
      const isError = e.kind === 'error' || e.name === 'client_error';
      log(isError ? 'error' : 'info', isError ? 'client_error' : 'analytics_event', {
        event: e.name, kind: e.kind === 'vital' ? 'vital' : isError ? 'error' : 'event',
        sessionId, uid: isError ? null : uid, path: pagePath, clientTs: Number(e.ts) || null, props,
      });
    }
    res.status(204).end();
  });

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
  // The fortnight's naturalist and palette (deep tone for ink, accent for the wash), mirrored from
  // constants/palettes.json in rotation order on the same ~15.21-day rotation as rotationAt, so the
  // link card wears the current theme. server/test/palettes.test.mjs checks the copy.
  const SHARE_THEMES = [
    ['E.O. Wilson', '#72371e', '#b74e03'], ['Alfred Russel Wallace', '#005d3b', '#067d59'], ['John James Audubon', '#873833', '#d42617'],
    ['Jane Goodall', '#00451b', '#007e44'], ['Alexander von Humboldt', '#5b3e81', '#9546d4'], ['Wangari Maathai', '#445801', '#637500'],
    ['John Muir', '#354666', '#536ca9'], ['Ralph Waldo Emerson', '#605000', '#836c02'], ['Charles Darwin', '#00515e', '#00788e'],
    ['Mary Anning', '#5c4819', '#896900'], ['Rachel Carson', '#035a5d', '#087a81'], ['David Attenborough', '#704903', '#956400'],
    ['Dian Fossey', '#0e4d4c', '#017a7e'], ['George Washington Carver', '#5c3917', '#9c6003'], ['Sylvia Earle', '#005875', '#0575a2'],
    ['Steve Irwin', '#4c4b25', '#776f1e'], ['Jacques-Yves Cousteau', '#0d346c', '#2766e3'], ['Beatrix Potter', '#394c23', '#597717'],
    ['Carl Linnaeus', '#444b8f', '#6258e9'], ['Robin Wall Kimmerer', '#305b26', '#008017'], ['Maria Sibylla Merian', '#753157', '#c62e82'],
    ['Salim Ali', '#035587', '#006fc8'], ['Aldo Leopold', '#7f4001', '#a55b01'], ['Henry David Thoreau', '#085546', '#047c6b'],
  ];
  // Row order of SHARE_THEMES (constants/palettes.json "order")
  const SHARE_ORDER = JSON.parse(fs.readFileSync(path.join(__dirname, '../constants/palettes.json'), 'utf8')).order;
  const shareTheme = (now = Date.now()) => {
    // The same naturalist as the browser tab and home-screen icon: local (India) date and the cutover
    const i = SHARE_ORDER.indexOf(naturalistAt(now));
    const [naturalist, deep, accent] = SHARE_THEMES[i >= 0 ? i : 0];
    return { naturalist, deep, accent };
  };

  const PLACEHOLDER_LABEL = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)$/i;

  app.get('/s/:postId', async (req, res) => {
    const postId = String(req.params.postId || '');
    const host = IS_PROD ? PUBLIC_HOST : (req.get('host') || PUBLIC_HOST);
    const scheme = IS_PROD || !/^(localhost|127\.0\.0\.1)/.test(host) ? 'https' : 'http';
    if (!POST_ID_RE.test(postId)) return res.redirect(302, '/');

    const siteUrl = `${scheme}://${host}/s/${postId}`;
    const appUrl = `${scheme}://${host}/post/${encodeURIComponent(postId)}`;
    const ua = req.headers['user-agent'] || '';
    const isCrawler = /bot|crawler|spider|crawling|facebookexternalhit|twitterbot|whatsapp|telegram|discord|slack|linkedin|embedly|pinterest/i.test(ua);
    // People opening a shared link land on the visitors' welcome for that post (members see it in the app)
    if (!isCrawler) return res.redirect(302, `${appUrl}?from=share`);

    const apiKey = firebaseWebConfig?.apiKey;
    const databaseId = firebaseWebConfig?.firestoreDatabaseId || '(default)';
    const theme = shareTheme();
    let title = 'NatureGram: a living field notebook';
    let heading = 'A wild sighting';
    let scientific = '';
    let byline = '';
    let description = 'Wild plants, animals, fungi and sounds, noticed and shared by explorers on NatureGram.';
    let imageUrl = `https://${PUBLIC_HOST}/og-default.jpg?v=2`;
    let tags = [];
    let ld = null;
    let shown = true;
    // The store (Admin SDK) decides first, with the full privacy rules (teens, hidden, moderation);
    // only when it can't answer does the card fall back to the public REST read.
    const preview = seo ? await seo.sharePreview(postId).catch(() => null) : null;
    if (preview && preview.public) {
      const p = preview.post;
      const name = p.name || p.title || 'A wild sighting';
      heading = name;
      scientific = p.scientific && p.scientific !== name ? p.scientific : '';
      title = `${name}, seen${p.area ? ` near ${p.area}` : ''} · NatureGram`;
      byline = [p.author, p.area ? `near ${p.area}` : ''].filter(Boolean).join(' · ');
      description = p.caption || p.observed || p.insight || `${p.author || 'An explorer'} found this ${p.name || 'sighting'}${p.area ? ` near ${p.area}` : ''}. What's alive near you?`;
      imageUrl = p.image || p.thumb || imageUrl;
      tags = p.tags.slice(0, 8);
      ld = preview.ld;
    } else if (preview) {
      shown = false;
    } else try {
      if (!apiKey) throw new Error('No Firebase config');
      const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseProjectId)}/databases/${encodeURIComponent(databaseId)}/documents/ecosystem_feed/${postId}?key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('Post not found');
      const f = (await r.json()).fields || {};
      if (f.isPublic?.booleanValue === true) {
        const items = f.items?.arrayValue?.values || [];
        const main = items.length ? (items[0].mapValue?.fields || {}) : f;
        const labels = (main.labels?.arrayValue?.values || f.labels?.arrayValue?.values || []).map(v => v.stringValue).filter(Boolean);
        // The common name first, as the app shows it (the guide's name for a Latin-only label)
        const plain = (v) => v?.stringValue ?? (v?.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)])) : v?.arrayValue ? (v.arrayValue.values || []).map(plain) : undefined);
        const first = String(leadName({ labels, aiIdentifications: plain(main.aiIdentifications || f.aiIdentifications) || [], behavior: main.behavior?.stringValue || f.behavior?.stringValue }) || labels[0] || '').trim();
        const species = first && !PLACEHOLDER_LABEL.test(first) ? first : '';
        const flags = (main.aiFlags || f.aiFlags)?.mapValue?.fields || {};
        const showLocation = (main.showLocation || f.showLocation)?.booleanValue;
        const hidden = showLocation === false || flags.sensitiveSpecies?.booleanValue === true;
        const area = hidden ? '' : String(main.locationArea?.stringValue || f.locationArea?.stringValue || '').trim().slice(0, 80);
        const name = species || String(f.title?.stringValue || '').trim() || 'A wild sighting';
        heading = name;
        scientific = labels[1] && /^[A-Z][a-z]+ [a-z]+/.test(labels[1]) ? labels[1] : (labels[0] && labels[0] !== name && /^[A-Z][a-z]+ [a-z]+$/.test(labels[0]) ? labels[0] : '');
        title = `${name}, seen${area ? ` near ${area}` : ''} · NatureGram`;
        const explorer = String(f.userName?.stringValue || '').trim();
        byline = [explorer, area ? `near ${area}` : ''].filter(Boolean).join(' · ');
        const behaviour = String(main.behavior?.stringValue || f.behavior?.stringValue || '').trim();
        const observed = behaviour && !/^(captured|uploaded|recorded)\s+(photo|media|video|audio|sound)\.?$/i.test(behaviour) ? behaviour : '';
        description = f.caption?.stringValue || observed || f.description?.stringValue || main.aiInsight?.stringValue || f.aiInsight?.stringValue
          || `${explorer || 'An explorer'} found this ${species || 'sighting'}${area ? ` near ${area}` : ''}. What's alive near you?`;
        imageUrl = safeHttpsUrl(f.thumbnailUrl?.stringValue || f.imageUrl?.stringValue || main.thumbnailUrl?.stringValue || main.imageUrl?.stringValue, imageUrl);
        tags = (f.tags?.arrayValue?.values || []).map(v => v.stringValue).filter(Boolean).slice(0, 8);
      }
    } catch (e) {
      log('warn', 'share preview fallback', { postId, error: e.message });
    }
    title = title.slice(0, 140);
    description = description.slice(0, 300);

    const e = escapeHtml;
    const tagHtml = tags.length
      ? tags.map(t => `<span class="tag">#${e(String(t).replace(/^#+/, ''))}</span>`).join('')
      : `<span class="note">Shared during ${e(theme.naturalist)}'s fortnight on NatureGram</span>`;
    // Theme colours come from the fixed table above, never from user input; still validated as hex.
    const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c : d);
    const wash = hex(theme.accent, '#a8a29e');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<link rel="canonical" href="${e(appUrl)}">${shown ? '' : '\n<meta name="robots" content="noindex">'}
<meta property="og:type" content="article"><meta property="og:site_name" content="NatureGram">
<meta property="og:url" content="${e(siteUrl)}"><meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}"><meta property="og:image" content="${e(imageUrl)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}"><meta name="twitter:image" content="${e(imageUrl)}">
<meta property="og:image:alt" content="${e(heading)}"><meta name="theme-color" content="#fcfaf8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fcfaf8;color:#44403c;min-height:100vh;padding:24px;display:flex;flex-direction:column;align-items:center}
.top{width:100%;max-width:440px;display:flex;align-items:center;gap:10px;margin:0 0 32px}
.top svg{width:22px;height:22px;color:#1c1917}
.brand{font-family:Newsreader,Georgia,serif;font-style:italic;font-size:20px;color:#1c1917;margin:0;letter-spacing:-.01em}
.card{max-width:440px;width:100%}
img{width:100%;aspect-ratio:4/5;object-fit:cover;background:#f3efe7;display:block;border-radius:6px}
.kicker{display:flex;align-items:center;gap:12px;font-size:14px;color:#57534e;margin:28px 0 0}
.kicker:before{content:"";display:block;width:32px;height:1px;background:${wash}}
h1{font-family:Newsreader,Georgia,serif;font-style:italic;font-weight:400;font-size:28px;line-height:1.2;color:#1c1917;margin:12px 0 2px}
.sci{font-family:Newsreader,Georgia,serif;font-style:italic;color:#78716c;margin:0;font-size:16px}
.by{font-size:12px;color:#78716c;margin:10px 0 0}
p.desc{font-size:16px;line-height:1.65;color:#44403c;margin:16px 0}
.tag{display:inline-block;margin:0 12px 4px 0;color:#57534e;font-size:14px}
.note{font-size:12px;color:#78716c}
a.btn{display:inline-flex;align-items:center;gap:10px;margin-top:24px;min-height:48px;padding:0 22px 0 24px;border-radius:999px;background:#1c1917;color:#fff;text-decoration:none;font-weight:600;font-size:15px}
a.btn span{color:${wash}}
a:focus-visible{outline:3px solid ${wash};outline-offset:2px}
</style>${ld ? `\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}</head>
<body><header class="top"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.7" fill="currentColor"/><path d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M5.8 18.2l1.7-1.7M16.5 7.5l1.7-1.7" stroke-width="2"/></svg><p class="brand">NatureGram</p></header>
<main class="card">
<a href="${e(appUrl)}"><img src="${e(imageUrl)}" alt="${e(heading)}" referrerpolicy="no-referrer"></a>
<p class="kicker">A sighting on NatureGram</p>
<h1>${e(heading)}</h1>
${scientific ? `<p class="sci">${e(scientific)}</p>` : ''}
${byline ? `<p class="by">${e(byline)}</p>` : ''}
<p class="desc">${e(description)}</p>
<div>${tagHtml}</div>
<a class="btn" href="${e(appUrl)}">Open this sighting <span aria-hidden="true">&rarr;</span></a>
</main></body></html>`);
  });

  // -------------------------------------------------------------------------
  // Gemini HTTP proxy: NatureGram tasks only, admin-governed, allowance-checked
  // -------------------------------------------------------------------------
  const ipLimiter = rateLimit({ windowMs: 15 * 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
  const bearer = (req) => {
    const h = req.headers.authorization || '';
    return (h.startsWith('Bearer ') ? h.slice(7) : null) || req.headers['x-goog-api-key'] || '';
  };
  app.use('/api-proxy', ipLimiter, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    let url;
    try { url = new URL(req.url, `https://${TARGET_HOST}`); } catch { return res.status(400).json({ error: 'Bad request' }); }
    const fail = (status, message) => res.status(status).json({ error: { code: status, message } });

    let user;
    try { user = await verifyIdToken(String(bearer(req))); } catch { return fail(401, 'Please sign in again.'); }
    const unverified = await appCheckVerdict(req.headers['x-firebase-appcheck'], { log, route: '/api-proxy', uid: user.uid });
    if (unverified) return fail(unverified.status, unverified.message);

    const verdict = governGenerateRequest(url.pathname);
    if (!verdict.ok) {
      log('warn', 'blocked gemini path', { uid: user.uid, reason: verdict.reason });
      logAi({ uid: user.uid, anon: user.isAnonymous, task: 'blocked', status: 403, flags: { offTask: true }, ip: clientIp(req) });
      return fail(403, verdict.reason);
    }
    const len = Number(req.headers['content-length'] || 0);
    if (len > QUOTAS.maxBodyBytes) return fail(413, 'Media too large to analyze.');

    const blocked = await gate(user, clientIp(req));
    if (blocked) return fail(blocked.status, blocked.message);
    const over = await chargeTask(user, verdict.spec);
    if (over) return fail(over.status, over.message);
    if (!API_KEY) return fail(503, 'AI is not configured on the server.');

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
      return fail(e.message === 'too_large' ? 413 : 400, 'Media too large to analyze.');
    }

    const settings = await getSettings();
    const model = modelFor(settings, verdict.task);
    let payload;
    try {
      payload = Buffer.from(JSON.stringify(governGenerateBody(verdict.task, JSON.parse(raw.toString('utf8') || '{}'), settings)));
    } catch (e) {
      return fail(e.status || 400, e.status ? e.message : 'Invalid request body.');
    }

    const started = Date.now();
    const proxyReq = https.request({
      hostname: TARGET_HOST, port: 443, method: 'POST', timeout: 120_000,
      path: `/${verdict.version}/models/${encodeURIComponent(model)}:generateContent`,
      headers: {
        host: TARGET_HOST, 'content-type': 'application/json', 'content-length': String(payload.length),
        origin: `https://${PUBLIC_HOST}`, referer: `https://${PUBLIC_HOST}/`, 'x-goog-api-key': API_KEY,
      },
    }, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', async () => {
        const status = proxyRes.statusCode || 502;
        let buf = Buffer.concat(chunks);
        let usage = null, finish = null, blockReason = null;
        const flags = {};
        try {
          const json = JSON.parse(buf.toString('utf8'));
          usage = json.usageMetadata || null;
          finish = json.candidates?.[0]?.finishReason || null;
          blockReason = json.promptFeedback?.blockReason || null;
          const part = json.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string');
          if (status < 400 && part && verdict.task === 'ng-identify') {
            const out = JSON.parse(part.text);
            // Enforce the policy on the answer, not just the prompt
            const breach = findPolicyBreach(out.ecologic) || findPolicyBreach(out.safetyNote);
            if (breach) { flags.policyBreach = breach; out.ecologic = ''; out.safetyNote = 'Never eat, touch or use a wild organism based on an AI identification.'; }
            if (out.flags?.isNatureSubject === false) flags.notNature = true;
            if (out.flags?.peopleVisible) flags.people = true;
            // Remember what the guide actually said, so a post can only show the guide's real words
            if (firestoreDb) {
              const ref = firestoreDb.collection('ai_results').doc();
              await ref.set({
                uid: user.uid, ecologic: String(out.ecologic || '').slice(0, 2000),
                confidence: out.overallConfidence || null,
                labels: (out.identifications || []).slice(0, 6).map(i => String(i.commonName || i.scientificName || '').slice(0, 80)),
                flags: out.flags || null, model, createdAt: FieldValue.serverTimestamp(),
                expireAt: Timestamp.fromMillis(Date.now() + 3 * 86_400_000),
              }).then(() => { out.ngResultId = ref.id; }).catch(() => {});
            }
            part.text = JSON.stringify(out);
            buf = Buffer.from(JSON.stringify(json));
          } else if (status < 400 && part && verdict.task === 'ng-curate') {
            // Curator notes are shown to strangers: drop any that carry links or promotions
            const out = JSON.parse(part.text);
            out.curatedItems = (out.curatedItems || []).filter(i => !/https?:|www\.|\.(com|net|xyz|io)\b/i.test(String(i.curatorNote || '')));
            part.text = JSON.stringify(out);
            buf = Buffer.from(JSON.stringify(json));
          }
        } catch { /* non-JSON or unexpected shape: pass through untouched */ }
        const headers = { ...proxyRes.headers };
        delete headers['set-cookie']; delete headers['content-length']; delete headers['transfer-encoding']; delete headers['content-encoding'];
        res.writeHead(status, { ...headers, 'content-length': String(buf.length) });
        res.end(buf);
        const total = usage?.totalTokenCount || 0;
        addGlobalTokens(total);
        logAi({ uid: user.uid, anon: user.isAnonymous, task: verdict.task, model, status, ms: Date.now() - started,
          promptTokens: usage?.promptTokenCount ?? null, outputTokens: usage?.candidatesTokenCount ?? null, totalTokens: total || null,
          finishReason: finish, blockReason, flags, ip: clientIp(req) });
        log(status >= 400 ? 'warn' : 'info', 'gemini http', { uid: user.uid, task: verdict.task, model, status, ms: Date.now() - started, totalTokens: total || null, finishReason: finish, blockReason });
      });
    });
    proxyReq.on('timeout', () => proxyReq.destroy(new Error('timeout')));
    proxyReq.on('error', (err) => {
      log('error', 'gemini http proxy error', { uid: user.uid, error: err.message });
      if (!res.headersSent) fail(502, 'AI service unavailable. Please retry.');
    });
    proxyReq.end(payload);
  });

  // First page of the feed as plain JSON: arrives before the database SDK has even started,
  // and is shared by everyone for a few seconds (fast on slow connections, cheap to serve).
  // The same page feeds the first tiles inlined into index.html (see server/media.js).
  let firstPage = { at: 0, body: null, tiles: null };
  let firstPageLoading = null;
  // When this server's credentials can't read Firestore via Admin SDK (e.g. a preview environment),
  // fall back to the public Firestore REST read on feed_thumbnails for 10 minutes before retrying Admin.
  let firstPageDeniedUntil = 0;
  const fromRestVal = (v) => {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('timestampValue' in v) {
      const ms = Date.parse(v.timestampValue);
      return Number.isFinite(ms) ? { toMillis: () => ms } : null;
    }
    if ('arrayValue' in v) return (v.arrayValue?.values || []).map(fromRestVal);
    if ('mapValue' in v) return fromRestFields(v.mapValue?.fields);
    return null;
  };
  function fromRestFields(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) out[k] = fromRestVal(v);
    return out;
  }
  async function loadFirstPageRest() {
    const apiKey = firebaseWebConfig?.apiKey;
    const databaseId = firebaseWebConfig?.firestoreDatabaseId || '(default)';
    if (!apiKey) throw new Error('No Firebase config');
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseProjectId)}/databases/${encodeURIComponent(databaseId)}/documents:runQuery?key=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'feed_thumbnails' }],
          where: { fieldFilter: { field: { fieldPath: 'isPublic' }, op: 'EQUAL', value: { booleanValue: true } } },
          orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
          limit: 12,
        },
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(`REST ${r.status}`);
    const rows = await r.json();
    const docs = (Array.isArray(rows) ? rows : []).map(x => x?.document).filter(Boolean);
    const posts = docs.map(doc => feedFirstPost(String(doc.name || '').split('/').pop(), fromRestFields(doc.fields)));
    firstPage = {
      at: Date.now(),
      body: JSON.stringify({ posts, more: docs.length === 12 }),
      tiles: firstTilesJson(posts),
    };
    return firstPage;
  }
  async function loadFirstPage() {
    if (!firestoreDb || Date.now() < firstPageDeniedUntil) return loadFirstPageRest();
    try {
      const snap = await firestoreDb.collection('feed_thumbnails').where('isPublic', '==', true).orderBy('timestamp', 'desc').limit(12).get();
      const posts = snap.docs.map(d => feedFirstPost(d.id, d.data()));
      firstPage = {
        at: Date.now(),
        body: JSON.stringify({ posts, more: snap.size === 12 }),
        tiles: firstTilesJson(posts),
      };
      return firstPage;
    } catch (e) {
      if (/PERMISSION_DENIED/.test(String(e?.message || ''))) {
        firstPageDeniedUntil = Date.now() + 10 * 60_000;
        return loadFirstPageRest();
      }
      throw e;
    }
  }
  function refreshFirstPage() {
    if (!firstPageLoading) {
      firstPageLoading = loadFirstPage().catch((e) => {
        const msg = String(e.message).slice(0, 120);
        log('warn', 'first page failed', { error: msg });
        throw e;
      }).finally(() => { firstPageLoading = null; });
    }
    return firstPageLoading;
  }
  /** The first tiles for the page, from the cached first page (refreshed in the background, never awaited). */
  const firstTilesNow = () => {
    if (Date.now() - firstPage.at > 20_000) refreshFirstPage().catch(() => {});
    // An old page is fine for a first paint (the app refreshes it at once), but not a very old one
    return firstPage.tiles && Date.now() - firstPage.at < 15 * 60_000 ? firstPage.tiles : null;
  };
  refreshFirstPage().catch(() => {});
  app.get('/api/feed/first', async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=20, s-maxage=30, stale-while-revalidate=120');
    if (firstPage.body && Date.now() - firstPage.at < 20_000) return res.type('json').send(firstPage.body);
    try {
      const page = await refreshFirstPage();
      res.type('json').send(page.body);
    } catch {
      // A slightly old page beats an empty one
      if (firstPage.body) return res.type('json').send(firstPage.body);
      res.status(503).json({ posts: [] });
    }
  });

  // What an explorer has left today (shown in the app)
  app.get('/api/me/allowance', async (req, res) => {
    let user;
    try { user = await verifyIdToken(String(bearer(req))); } catch { return res.status(401).json({ error: 'Please sign in again.' }); }
    const [flags, used] = await Promise.all([getFlags(), usageFor(user.uid)]);
    const a = flags.allowances;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      available: used !== null,
      posts: { limit: a.postsPerDay, used: used?.posts || 0 },
      liveMinutes: { limit: a.liveMinutesPerDay, used: Math.ceil((used?.liveMs || 0) / 60_000), usedMs: used?.liveMs || 0 },
      identifications: { limit: a.identificationsPerDay, used: used?.identify || 0 },
      // "Only me" saves have their own generous cap (sharing them later uses posts)
      privateSaves: { limit: Number(a.privateSavesPerDay) || 200, used: used?.privateSaves || 0 },
      resetsAt: nextReset(),
      resetsAtText: RESET_WORDS,
    });
  });

  mountPublish(app, { verifyIdToken, bearer, gate, clientIp, log, db: () => firestoreDb, apiKey: API_KEY, targetHost: TARGET_HOST, publicHost: PUBLIC_HOST });
  mountGuardian(app, { verifyIdToken, bearer, clientIp, log, db: () => firestoreDb, auth: () => getAuth(), theme: () => shareTheme() });
  mountAdmin(app, { verifyIdToken, bearer, clientIp, log, db: () => firestoreDb, auth: () => getAuth(),
    status: () => ({ appCheck: appCheckStats(), leases: leaseHealth(), liveDirect: LIVE_DIRECT_TOKENS, moderationFailOpen: process.env.MODERATION_FAIL_OPEN !== 'false' }) });

  // Per-network hourly cap on new live sessions (shared by the proxy and direct tokens)
  const networkOpen = (ip, settings) => {
    const hour = Math.floor(Date.now() / 3_600_000);
    const net = networkLive.get(ip);
    const n = net && net.hour === hour ? net : { hour, opened: 0, concurrent: net?.concurrent || 0 };
    if (n.opened >= Number(settings.caps.liveSessionsPerNetworkPerHour || 20)) return 'Too many live sessions from this network. Please try later.';
    n.opened++;
    networkLive.set(ip, n);
    return null;
  };
  mountLive(app, { verifyIdToken, bearer, gate, burstOk, clientIp, log, quotas: QUOTAS, networkOpen, apiKey: API_KEY });
  mountAuthMail(app, { verifyIdToken, bearer, clientIp, log, auth: () => getAuth() });
  // DELETE /api/me: the whole account, by the server (needs a sign-in in the last 10 minutes)
  const storageBucketName = process.env.FIREBASE_STORAGE_BUCKET || firebaseWebConfig?.storageBucket || null;
  mountAccountDeletion(app, { bearer, log, db: () => firestoreDb, auth: () => getAuth(), bucket: () => (storageBucketName ? getStorage().bucket(storageBucketName) : null) });

  // -------------------------------------------------------------------------
  // Frontend
  // -------------------------------------------------------------------------
  const server = http.createServer(app);
  // Only real app routes get the app; anything else is a proper 404
  const APP_ROUTE = /^\/(?:$|feed\/?$|journal\/?$|drafts\/?$|messages\/?$|reels\/?$|explore\/?$|guardian\/?$|lens\/?$|review\/?$|admin\/?$|auth\/action\/?$|welcome\/?$|profile(?:\/[^/]+)?\/?$|post\/[A-Za-z0-9_-]{1,128}\/?$)/;
  const seoDeps = { db: () => firestoreDb, firstTiles: firstTilesNow, log, publicHost: PUBLIC_HOST, iosUrl: process.env.IOS_APP_URL || '', androidUrl: process.env.ANDROID_APP_URL || '' };
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa', root: ROOT_DIR });
    seo = mountSeo(app, {
      ...seoDeps,
      shell: async (url) => vite.transformIndexHtml(url, fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8')),
      naturalists: async () => {
        const [a, b] = await Promise.all([vite.ssrLoadModule('/constants/naturalists.ts'), vite.ssrLoadModule('/constants/naturalistExtras.ts')]);
        return { themes: a.NATURALIST_THEMES, extras: b.NATURALIST_EXTRAS };
      },
      notFoundFile: path.join(ROOT_DIR, 'public', '404.html'),
    });
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !APP_ROUTE.test(req.path) || !(req.headers.accept || '').includes('text/html')) return next();
      seo.appShell(req, res).catch(next);
    });
    app.use(vite.middlewares);
  } else {
    const staticPath = path.join(ROOT_DIR, 'dist');
    let shellHtml = null;
    seo = mountSeo(app, {
      ...seoDeps,
      shell: async () => (shellHtml ??= fs.readFileSync(path.join(staticPath, 'index.html'), 'utf8')),
      // Written at build time from constants/naturalists.ts (see vite.config.ts)
      naturalists: async () => JSON.parse(fs.readFileSync(path.join(staticPath, 'seo', 'naturalists.json'), 'utf8')),
      notFoundFile: path.join(staticPath, '404.html'),
    });
    app.use('/assets', express.static(path.join(staticPath, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(staticPath, {
      index: false,
      setHeaders: (res, p) => { if (p.endsWith('.html') || p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); },
    }));
    // Friendly addresses for the legal pages
    app.get(['/privacy', '/terms'], (req, res) => res.redirect(301, `${req.path}.html`));
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      if (!APP_ROUTE.test(req.path)) {
        res.setHeader('X-Robots-Tag', 'noindex');
        return res.status(404).sendFile(path.join(staticPath, '404.html'));
      }
      // The app, with this route's title, description, social cards and structured data
      seo.appShell(req, res).catch(next);
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
    const split = splitWsAppCheck(reqUrl.pathname.replace(/^\/api-proxy\/*/, '/'));
    const relPath = split.path;
    if (!/bidigeneratecontent/i.test(relPath) || relPath.includes('..')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    let user;
    try {
      user = await verifyIdToken(reqUrl.searchParams.get('access_token') || reqUrl.searchParams.get('key') || '');
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }

    const ip = clientIp(req);
    const refuse = (code, message) => wss.handleUpgrade(req, socket, head, (ws) => { try { ws.close(code, message.slice(0, 120)); } catch { /* noop */ } });
    const unverified = await appCheckVerdict(split.token, { log, route: 'live', uid: user.uid });
    if (unverified) return refuse(4401, unverified.message);
    const blocked = await gate(user, ip, { live: true });
    if (blocked) return refuse(blocked.status === 503 ? 1013 : 4403, blocked.message);
    const [flags, settings, used] = await Promise.all([getFlags(), getSettings(), usageFor(user.uid)]);
    if (used === null) return refuse(1013, 'The guide is unavailable for a moment. Please try again.');
    const dayMs = Math.max(0, Number(flags.allowances.liveMinutesPerDay) || 0) * 60_000;
    const leftMs = dayMs - (used.liveMs || 0);
    if (leftMs < 5_000) return refuse(4429, `You've used today's ${flags.allowances.liveMinutesPerDay} live minutes. They reset ${RESET_WORDS}.`);
    // Per-network limits stop one person cycling guest accounts
    const hour = Math.floor(Date.now() / 3_600_000);
    const net = networkLive.get(ip);
    const n = net && net.hour === hour ? net : { hour, opened: 0, concurrent: net?.concurrent || 0 };
    if (n.opened >= Number(settings.caps.liveSessionsPerNetworkPerHour || 20)) return refuse(4429, 'Too many live sessions from this network. Please try later.');
    if (n.concurrent >= Number(settings.caps.liveConcurrentPerNetwork || 4)) return refuse(4429, 'Too many live sessions open on this network.');
    if (!API_KEY) return refuse(1011, 'AI is not configured on the server.');
    // This instance's own count first (cheap), then the shared count across instances
    if ((activeLive.get(user.uid)?.size || 0) >= QUOTAS.maxConcurrentLive) return refuse(4429, 'A live session is already open. Close other tabs and retry.');
    const lease = await acquireLease(user.uid, { perUser: QUOTAS.maxConcurrentLive, global: QUOTAS.maxConcurrentLiveGlobal, kind: 'proxy' });
    if (!lease.ok) return refuse(4429, lease.reason === 'global' ? 'The guide is very busy right now. Please try again in a minute.' : 'A live session is already open. Close other tabs and retry.');
    const releaseLease = holdLease(lease);
    socket.once('close', releaseLease); // idempotent; also covers an upgrade that never completes

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const closeWith = (code, reason) => { try { clientWs.close(code, reason); } catch { /* noop */ } };
      const conns = activeLive.get(user.uid) || new Set();
      if (conns.size >= QUOTAS.maxConcurrentLive) { releaseLease(); return closeWith(4429, 'A live session is already open. Close other tabs and retry.'); }

      const session = { startedAt: Date.now() };
      conns.add(session);
      activeLive.set(user.uid, conns);
      n.opened++; n.concurrent++;
      networkLive.set(ip, n);
      const remaining = Math.min(QUOTAS.liveSessionMaxMs, leftMs);
      const timeout = setTimeout(() => closeWith(4408, `That's today's live time. It resets ${RESET_WORDS}.`), remaining);
      // Close sessions that stop sending audio/video (closed tab, frozen device) to conserve the allowance
      const IDLE_MS = num(process.env.LIVE_IDLE_TIMEOUT_SEC, 60) * 1000;
      let idleTimer = setTimeout(() => closeWith(4408, 'Session closed after inactivity.'), IDLE_MS);
      clientWs.isAlive = true;
      clientWs.on('pong', () => { clientWs.isAlive = true; });

      const target = new WebSocket(`wss://${TARGET_HOST}${relPath}?key=${encodeURIComponent(API_KEY)}`, { headers: { host: TARGET_HOST } });
      const queue = [];
      let targetOpen = false;
      let setupSeen = false;
      let finished = false;
      let offTask = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        releaseLease();
        clearTimeout(timeout);
        clearTimeout(idleTimer);
        const ms = Date.now() - session.startedAt;
        record(user.uid, 'liveMs', ms);
        conns.delete(session);
        if (!conns.size) activeLive.delete(user.uid);
        n.concurrent = Math.max(0, n.concurrent - 1);
        logAi({ uid: user.uid, anon: user.isAnonymous, task: 'live', model: settings.models.live, status: 200, ms, flags: offTask ? { offTask: true } : {}, ip });
        log('info', 'live session ended', { uid: user.uid, anon: user.isAnonymous, ms });
      };
      log('info', 'live session started', { uid: user.uid, anon: user.isAnonymous });

      const forward = (data, isBinary) => {
        clientWs.isAlive = true;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => closeWith(4408, 'Session closed after inactivity.'), IDLE_MS);
        let msg;
        try { msg = JSON.parse(isBinary ? Buffer.from(data).toString('utf8') : data.toString()); } catch { msg = null; }
        if (!setupSeen) {
          // First frame: the admin's model, prompt, policy and tool list replace whatever the app sent
          setupSeen = true;
          try {
            data = Buffer.from(JSON.stringify(governLiveSetup(msg, settings)));
            isBinary = false;
          } catch {
            return closeWith(1008, 'Invalid session setup');
          }
        } else if (!allowedLiveMessage(msg)) {
          // No second setup, no unknown message types
          offTask = true;
          log('warn', 'live message refused', { uid: user.uid, keys: msg ? Object.keys(msg).slice(0, 5) : null });
          return closeWith(1008, 'Unsupported message');
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

  // Terminate dead WebSocket connections (no pong within 20 s)
  const sweep = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch { /* noop */ } continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* noop */ }
    }
  }, 20_000);
  sweep.unref();

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
