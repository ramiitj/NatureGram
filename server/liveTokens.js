/**
 * Direct live sessions with Gemini ephemeral tokens (opt-in: LIVE_DIRECT_TOKENS=true).
 *
 * Instead of streaming audio and video through this server, the app asks for a one-use token
 * and connects straight to Gemini's constrained Live endpoint. Governance stays on the server:
 *  - the token is minted only after the same checks as the proxy (signed in, switches, suspensions,
 *    blocked networks, spending ceiling, per-minute rate, today's live minutes, network limits and
 *    the shared concurrency lease);
 *  - liveConnectConstraints lock the model to the admin's live model and the config to the same
 *    composition the proxy writes into the setup frame (admin live prompt + session context as
 *    quoted DATA + platform policy, NatureGram's own camera tools only, generation settings),
 *    plus the safety settings. The app cannot change the model, prompt or tools;
 *  - the token works once (uses=1), must start a session within about a minute, and expires at the
 *    session-length cap or when today's minutes run out, whichever is sooner.
 *
 * Live minutes: the app heartbeats its lease every 30 s and reports the session length at the end.
 * The server charges what it reports, never less than the time up to its last heartbeat and never
 * more than the token's lifetime. When no end report arrives, a sweeper charges the token's full
 * lifetime (the upper bound).
 *
 * Endpoints: GET /api/live/config, POST /api/live/token, POST /api/live/heartbeat, POST /api/live/end.
 */
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { Timestamp } from 'firebase-admin/firestore';
import { governLiveSetup, SAFETY_SETTINGS } from './aiGovernance.js';
import { getFlags, getSettings } from './settings.js';
import { usageFor, record, logAi, RESET_WORDS } from './ledger.js';
import { acquire, heartbeat, getDirect, settleDirect, sweepDirect, HEARTBEAT_MS } from './liveLeases.js';
import { appCheckMiddleware } from './appCheck.js';

export const LIVE_DIRECT_TOKENS = process.env.LIVE_DIRECT_TOKENS === 'true';
const NEW_SESSION_MS = 60_000;

/**
 * The locked Live config for a token: exactly what governLiveSetup would send upstream for the
 * same request, expressed as LiveConnectConfig fields, plus the safety settings.
 */
export function constraintsFor(settings, clientSetup = {}) {
  const governed = governLiveSetup({ setup: {
    model: 'ignored',
    systemInstruction: clientSetup.systemInstruction,
    tools: clientSetup.tools,
    generationConfig: clientSetup.generationConfig || {},
  } }, settings).setup;
  const g = governed.generationConfig || {};
  const config = { systemInstruction: governed.systemInstruction, safetySettings: SAFETY_SETTINGS };
  if (governed.tools) config.tools = governed.tools;
  if (g.responseModalities || g.response_modalities) config.responseModalities = g.responseModalities || g.response_modalities;
  if (g.speechConfig || g.speech_config) config.speechConfig = g.speechConfig || g.speech_config;
  if (typeof g.temperature === 'number') config.temperature = g.temperature;
  return { model: governed.model, config };
}

export function mountLive(app, deps) {
  const { verifyIdToken, bearer, gate, burstOk, clientIp, log, quotas, networkOpen } = deps;
  const json = express.json({ limit: '64kb' });
  const ac = appCheckMiddleware(log, '/api/live');

  const chargeDirect = async (uid, ms, data) => {
    await record(uid, 'liveMs', ms);
    logAi({ uid, task: 'live', model: data?.model || null, status: 200, ms, flags: { direct: true, ...(data?.endReported ? {} : { noEndReport: true }) } });
  };
  if (LIVE_DIRECT_TOKENS) {
    const t = setInterval(() => { sweepDirect((uid, ms, data) => chargeDirect(uid, ms, data), log).then(n => { if (n) log('info', 'live sessions charged without end report', { n }); }); }, 120_000);
    t.unref?.();
  }

  app.get('/api/live/config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ direct: LIVE_DIRECT_TOKENS, heartbeatMs: HEARTBEAT_MS });
  });

  const auth = async (req, res) => {
    try { return await verifyIdToken(String(bearer(req))); } catch { res.status(401).json({ ok: false, message: 'Please sign in again.' }); return null; }
  };

  app.post('/api/live/token', ac, json, async (req, res) => {
    const say = (status, code, message) => res.status(status).json({ ok: false, code, message });
    if (!LIVE_DIRECT_TOKENS) return say(404, 'off', 'Direct live sessions are not enabled.');
    if (!deps.apiKey) return say(503, 'unconfigured', 'AI is not configured on the server.');
    const user = await auth(req, res); if (!user) return;
    const ip = clientIp(req);
    const blocked = await gate(user, ip, { live: true });
    if (blocked) return say(blocked.status, 'blocked', blocked.message);
    if (!burstOk(user.uid)) return say(429, 'rate', 'Too many requests. Please slow down.');
    const [flags, settings, used] = await Promise.all([getFlags(), getSettings(), usageFor(user.uid)]);
    if (used === null) return say(503, 'unavailable', 'The guide is unavailable for a moment. Please try again.');
    const dayMs = Math.max(0, Number(flags.allowances.liveMinutesPerDay) || 0) * 60_000;
    const leftMs = dayMs - (used.liveMs || 0);
    if (leftMs < 5_000) return say(429, 'allowance', `You've used today's ${flags.allowances.liveMinutesPerDay} live minutes. They reset ${RESET_WORDS}.`);
    const netRefusal = networkOpen(ip, settings);
    if (netRefusal) return say(429, 'network', netRefusal);

    const lifetime = Math.min(quotas.liveSessionMaxMs, leftMs);
    const now = Date.now();
    let constraints;
    try { constraints = constraintsFor(settings, req.body?.setup || {}); } catch { return say(400, 'setup', 'Invalid session setup.'); }

    // Direct sessions need the shared store: without it the minutes could not be charged
    const lease = await acquire(user.uid, {
      perUser: quotas.maxConcurrentLive, global: quotas.maxConcurrentLiveGlobal, kind: 'direct',
      extra: { mintedAt: Timestamp.fromMillis(now), sessionExpireAt: Timestamp.fromMillis(now + lifetime), lastBeatAt: Timestamp.fromMillis(now), settled: false, model: constraints.model },
    });
    if (!lease.ok) return say(429, 'concurrent', lease.reason === 'global' ? 'The guide is very busy right now. Please try again in a minute.' : 'A live session is already open. Close other tabs and retry.');
    if (!lease.shared) return say(503, 'fallback', 'Use the standard connection.');

    const started = Date.now();
    try {
      const ai = new GoogleGenAI({ apiKey: deps.apiKey, httpOptions: { apiVersion: 'v1alpha' } });
      const token = await ai.authTokens.create({ config: {
        uses: 1,
        newSessionExpireTime: new Date(now + NEW_SESSION_MS).toISOString(),
        expireTime: new Date(now + lifetime).toISOString(),
        liveConnectConstraints: constraints,
        lockAdditionalFields: [],
      } });
      if (!token?.name) throw new Error('no token');
      logAi({ uid: user.uid, anon: user.isAnonymous, task: 'live-token', model: constraints.model, status: 200, ms: Date.now() - started, ip });
      log('info', 'live token minted', { uid: user.uid, model: constraints.model, lifetimeMs: lifetime });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, token: token.name, model: constraints.model, expireTime: new Date(now + lifetime).toISOString(), leaseId: lease.id, heartbeatMs: HEARTBEAT_MS });
    } catch (e) {
      // Give the slot back without charging anything; the app falls back to the proxy
      const d = await getDirect(lease.id, user.uid).catch(() => null);
      if (d) await settleDirect(d.ref, async () => {}, { reportedMs: 0 }).catch(() => {});
      logAi({ uid: user.uid, anon: user.isAnonymous, task: 'live-token', model: constraints.model, status: 502, ms: Date.now() - started, ip });
      log('warn', 'live token mint failed', { uid: user.uid, error: String(e?.message || e).slice(0, 160) });
      say(502, 'mint', 'Use the standard connection.');
    }
  });

  app.post('/api/live/heartbeat', json, async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const id = String(req.body?.leaseId || '');
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return res.status(400).json({ ok: false });
    const ok = await heartbeat(id, user.uid);
    res.status(ok ? 200 : 410).json({ ok });
  });

  app.post('/api/live/end', express.json({ limit: '4kb', type: ['application/json', 'text/plain'] }), async (req, res) => {
    const user = await auth(req, res); if (!user) return;
    const id = String(req.body?.leaseId || '');
    const ms = Number(req.body?.ms);
    const d = await getDirect(id, user.uid).catch(() => null);
    if (!d) return res.json({ ok: true, charged: null }); // already settled (or never existed)
    const out = await settleDirect(d.ref, (uid, chargeMs, data) => chargeDirect(uid, chargeMs, { ...data, endReported: true }), { reportedMs: Number.isFinite(ms) ? ms : 0 }).catch((e) => { log('warn', 'live end failed', { uid: user.uid, error: String(e.message).slice(0, 120) }); return null; });
    log('info', 'live session ended', { uid: user.uid, direct: true, ms: out?.ms ?? null });
    res.json({ ok: true, charged: out?.ms ?? null });
  });
}
