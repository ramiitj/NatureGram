/**
 * Admin API. Everything the admin console reads or changes goes through here, so:
 *  - only the admin can reach it: a verified, unrevoked sign-in carrying the `admin` custom claim
 *    (set only by scripts/set-admin.mjs with server credentials), a verified email, and the account
 *    named in ADMIN_UIDS (or ADMIN_EMAIL when ADMIN_UIDS is unset). Optionally two-step sign-in
 *    and a recent sign-in are required as well. All conditions must hold.
 *  - every change is checked, saved with its previous version, and written to the audit log.
 *  - lists are paged; nothing loads whole collections.
 *  - letters (direct messages) are never readable, except conversations someone has reported.
 */
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';
import { getFlags, getSettings, saveSection, listHistory, DEFAULT_FLAGS, DEFAULT_SETTINGS } from './settings.js';
import { audit, refreshSuspended, storeHealth, today } from './ledger.js';
import { AI_POLICY_VERSION } from './aiGovernance.js';
import { thumbnailOf } from './publish.js';
import { searchTokensFor, sameTokens } from './searchTokens.js';
import { exportable, namesOf, occurrenceRow, csvHeader, csvLine, metaXml, emlXml, zip } from './dwc.js';

const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'ram@iitj.ac.in').toLowerCase();
const SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 12);
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

// Collections the data explorer may page through (read only). Letters are deliberately absent.
const EXPLORABLE = {
  users: 'joinedAt', ecosystem_feed: 'timestamp', feed_thumbnails: 'timestamp', ai_feedback: 'createdAt',
  ai_log: 'at', ai_usage: 'updatedAt', usage_global: 'updatedAt', ai_results: 'createdAt', suspended: 'at',
  review_queue: 'createdAt', letter_reports: 'createdAt', content_reports: 'createdAt', admin_audit: 'at', app_config: null, themes: null,
  daily_themes: null, media_variants: null, naturalist_profiles: null, config: null, live_leases: 'startedAt',
};

/** Firestore values -> plain JSON (timestamps as milliseconds). */
const plain = (v) => {
  if (v == null) return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};
const docOut = (d) => ({ id: d.id, ...plain(d.data()) });

// ------------------------------------------------------------------------- validation
const bool = (v) => typeof v === 'boolean';
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const text = (v, max) => typeof v === 'string' && v.length <= max;

export function validateFlags(patch) {
  const out = {};
  for (const k of ['aiEnabled', 'liveEnabled', 'uploadsEnabled', 'guestsEnabled', 'lettersEnabled', 'signupsEnabled']) {
    if (k in patch) { if (!bool(patch[k])) throw new Error(`${k} must be on or off`); out[k] = patch[k]; }
  }
  if (patch.allowances) {
    const a = patch.allowances; out.allowances = {};
    if ('postsPerDay' in a) { if (!int(a.postsPerDay, 0, 100)) throw new Error('Posts per day must be 0 to 100'); out.allowances.postsPerDay = a.postsPerDay; }
    if ('liveMinutesPerDay' in a) { if (!int(a.liveMinutesPerDay, 0, 240)) throw new Error('Live minutes per day must be 0 to 240'); out.allowances.liveMinutesPerDay = a.liveMinutesPerDay; }
    if ('identificationsPerDay' in a) { if (!int(a.identificationsPerDay, 0, 500)) throw new Error('Identifications per day must be 0 to 500'); out.allowances.identificationsPerDay = a.identificationsPerDay; }
  }
  const extra = Object.keys(patch).filter(k => !(k in DEFAULT_FLAGS));
  if (extra.length) throw new Error(`Unknown setting: ${extra[0]}`);
  return out;
}

export function validateSettings(patch) {
  const out = {};
  if (patch.prompts) {
    out.prompts = {};
    for (const [k, v] of Object.entries(patch.prompts)) {
      if (!(k in DEFAULT_SETTINGS.prompts)) throw new Error(`Unknown prompt: ${k}`);
      if (!text(v, 20_000) || v.trim().length < 40) throw new Error(`The ${k} prompt must be 40 to 20,000 characters`);
      out.prompts[k] = v;
    }
  }
  if ('policy' in patch) {
    if (!text(patch.policy, 10_000) || patch.policy.trim().length < 40) throw new Error('The policy must be 40 to 10,000 characters');
    out.policy = patch.policy;
  }
  if (patch.models) {
    out.models = {};
    for (const [k, v] of Object.entries(patch.models)) {
      if (!(k in DEFAULT_SETTINGS.models)) throw new Error(`Unknown model slot: ${k}`);
      const ok = k === 'live' ? /^models\/gemini-[a-z0-9.-]{1,80}$/.test(v) : /^gemini-[a-z0-9.-]{1,80}$/.test(v);
      if (!ok) throw new Error(`Model for ${k} must be a Gemini model name`);
      out.models[k] = v;
    }
  }
  if (patch.caps) {
    const c = patch.caps; out.caps = {};
    const ranges = { maxOutputTokens: [256, 8192], thinkingBudget: [0, 8192], otherAiCallsPerDay: [0, 500], dailyTokenCeiling: [0, 1_000_000_000], liveSessionsPerNetworkPerHour: [1, 1000], liveConcurrentPerNetwork: [1, 100] };
    for (const [k, v] of Object.entries(c)) {
      if (!ranges[k]) throw new Error(`Unknown cap: ${k}`);
      if (!int(v, ranges[k][0], ranges[k][1])) throw new Error(`${k} must be ${ranges[k][0]} to ${ranges[k][1]}`);
      out.caps[k] = v;
    }
  }
  if (patch.guidance) {
    out.guidance = {};
    for (const [k, v] of Object.entries(patch.guidance)) {
      if (!(k in DEFAULT_SETTINGS.guidance)) throw new Error(`Unknown message: ${k}`);
      if (!text(v, 400) || !v.trim()) throw new Error(`The ${k} message must be 1 to 400 characters`);
      out.guidance[k] = v;
    }
  }
  if ('blockedNetworks' in patch) {
    const list = patch.blockedNetworks;
    if (!Array.isArray(list) || list.length > 500 || !list.every(p => typeof p === 'string' && /^[0-9a-f:.]{3,45}$/i.test(p))) throw new Error('Blocked networks must be IP addresses or prefixes');
    out.blockedNetworks = list;
  }
  if ('moderationWords' in patch) {
    const list = patch.moderationWords;
    if (!Array.isArray(list) || list.length > 500 || !list.every(w => typeof w === 'string' && w.trim().length >= 2 && w.length <= 40)) throw new Error('Review words must be a list of up to 500 words, 2 to 40 characters each');
    out.moderationWords = Array.from(new Set(list.map(w => w.trim().toLowerCase())));
  }
  if ('requireAdminMfa' in patch) {
    if (!bool(patch.requireAdminMfa)) throw new Error('requireAdminMfa must be on or off');
    out.requireAdminMfa = patch.requireAdminMfa;
  }
  const extra = Object.keys(patch).filter(k => !(k in DEFAULT_SETTINGS));
  if (extra.length) throw new Error(`Unknown setting: ${extra[0]}`);
  return out;
}

/**
 * Feature flags and experiments (config/flags, publicly readable):
 * { [name]: { enabled, rollout 0..100, variants?: [{ name, weight }], description? } }
 */
export function validateExperiments(flags) {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) throw new Error('Flags must be an object');
  const names = Object.keys(flags);
  if (names.length > 50) throw new Error('At most 50 flags');
  const out = {};
  for (const name of names) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(name)) throw new Error(`Flag names are lowercase letters, digits and underscores: ${name}`);
    const f = flags[name] || {};
    const allowed = ['enabled', 'rollout', 'variants', 'description'];
    const extra = Object.keys(f).filter(k => !allowed.includes(k));
    if (extra.length) throw new Error(`Unknown field on ${name}: ${extra[0]}`);
    if (!bool(f.enabled ?? false)) throw new Error(`${name}: enabled must be on or off`);
    const rollout = f.rollout ?? 0;
    if (typeof rollout !== 'number' || rollout < 0 || rollout > 100) throw new Error(`${name}: rollout must be 0 to 100`);
    const v = { enabled: f.enabled === true, rollout };
    if (f.description !== undefined) { if (!text(f.description, 200)) throw new Error(`${name}: description up to 200 characters`); v.description = f.description; }
    if (f.variants !== undefined) {
      if (!Array.isArray(f.variants) || f.variants.length < 2 || f.variants.length > 6) throw new Error(`${name}: 2 to 6 variants`);
      const seen = new Set();
      v.variants = f.variants.map(x => {
        if (!x || !/^[a-z][a-z0-9_]{0,23}$/.test(String(x.name)) || seen.has(x.name)) throw new Error(`${name}: variant names must be unique lowercase words`);
        if (!int(x.weight, 0, 100)) throw new Error(`${name}: variant weights are whole numbers 0 to 100`);
        seen.add(x.name);
        return { name: x.name, weight: x.weight };
      });
      if (!v.variants.some(x => x.weight > 0)) throw new Error(`${name}: at least one variant needs weight`);
    }
    out[name] = v;
  }
  return out;
}

// ------------------------------------------------------------------------- mount
export function mountAdmin(app, deps) {
  const { bearer, clientIp, log } = deps;
  const router = express.Router();
  router.use(rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }));
  router.use(express.json({ limit: '256kb' }));
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // Who may enter: every condition must hold
  router.use(async (req, res, next) => {
    const deny = (why) => {
      log('warn', 'admin access denied', { why, ip: clientIp(req), path: req.path });
      return res.status(403).json({ error: 'Not allowed.' });
    };
    let decoded;
    const token = String(bearer(req) || '');
    if (!token) return res.status(401).json({ error: 'You are not signed in on this page yet. Reload and try again.', code: 'no-token' });
    try {
      decoded = await deps.auth().verifyIdToken(token, true); // signature, expiry and revocation
    } catch (e) {
      // Record why (never the token). A permission error here means the revocation check could not read
      // the user from Firebase Auth: grant the server account Firebase Authentication Viewer.
      const code = String(e?.code || e?.errorInfo?.code || '');
      const msg = String(e?.message || '').slice(0, 200);
      const permission = /insufficient-permission|PERMISSION_DENIED|permission/i.test(code + ' ' + msg);
      log('warn', 'admin token check failed', { code, error: msg, path: req.path, ...(permission ? { hint: 'Grant the server account roles/firebaseauth.viewer on the Firebase project.' } : {}) });
      if (permission) return res.status(503).json({ error: "The server can't check admin sign-ins yet (it needs read access to Firebase Authentication).", code: 'auth-permission' });
      return res.status(401).json({ error: /revoked/i.test(code) ? 'Your session was signed out elsewhere. Sign in again.' : 'Please sign in again.', code: 'token' });
    }
    if (decoded.admin !== true) return deny('no claim');
    if (decoded.email_verified !== true) return deny('email not verified');
    if (ADMIN_UIDS.length ? !ADMIN_UIDS.includes(decoded.uid) : String(decoded.email || '').toLowerCase() !== ADMIN_EMAIL) return deny('not the named admin');
    const settings = await getSettings();
    if (settings.requireAdminMfa && !decoded.firebase?.sign_in_second_factor) return res.status(403).json({ error: 'Two-step sign-in is required for the admin console.', code: 'mfa' });
    if (Date.now() / 1000 - Number(decoded.auth_time || 0) > SESSION_HOURS * 3600) return res.status(401).json({ error: 'Please sign in again to use the admin console.', code: 'reauth' });
    req.admin = { uid: decoded.uid, email: decoded.email || null, ip: clientIp(req) };
    if (!deps.db()) return res.status(503).json({ error: 'The database is not reachable from the server. See /healthz.' });
    next();
  });

  const db = () => deps.db();
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      const msg = String(e?.message || e).slice(0, 300);
      log('error', 'admin endpoint error', { path: req.path, error: msg });
      res.status(e.status || 400).json({ error: msg });
    }
  };
  const page = async (name, req, orderField) => {
    const n = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    let query = db().collection(name).orderBy(orderField, 'desc');
    if (req.query.after && ID_RE.test(String(req.query.after))) {
      const cursor = await db().doc(`${name}/${req.query.after}`).get();
      if (cursor.exists) query = query.startAfter(cursor);
    }
    const snap = await query.limit(n).get();
    return { items: snap.docs.map(docOut), next: snap.size === n ? snap.docs[snap.size - 1].id : null };
  };

  // ---------------------------------------------------------------- overview
  router.get('/me', wrap(async (req, res) => res.json({ ...req.admin, policy: AI_POLICY_VERSION })));

  router.get('/overview', wrap(async (req, res) => {
    const d = db();
    const since = Timestamp.fromMillis(Date.now() - 86_400_000);
    const [flags, settings, global, logSnap, queue, reported, postsToday, letterReports, contentReports] = await Promise.all([
      getFlags(), getSettings(),
      d.doc(`usage_global/${today()}`).get(),
      d.collection('ai_log').where('at', '>=', since).orderBy('at', 'desc').limit(2000).get(),
      d.collection('review_queue').where('status', '==', 'open').count().get(),
      d.collection('ecosystem_feed').where('reportStatus', '==', 'pending').count().get(),
      d.collection('ecosystem_feed').where('timestamp', '>=', Timestamp.fromMillis(new Date(today() + 'T00:00:00Z').getTime())).count().get(),
      d.collection('letter_reports').where('status', '==', 'open').count().get().catch(() => ({ data: () => ({ count: 0 }) })),
      d.collection('content_reports').where('status', '==', 'open').count().get().catch(() => ({ data: () => ({ count: 0 }) })),
    ]);
    const byTask = {}; const flagged = {}; const users = new Set(); let errors = 0; let tokens = 0;
    const hourly = Array(24).fill(0);
    for (const doc of logSnap.docs) {
      const l = doc.data();
      byTask[l.task] = (byTask[l.task] || 0) + 1;
      if (l.status >= 400) errors++;
      tokens += l.totalTokens || 0;
      users.add(l.uid);
      for (const [k, v] of Object.entries(l.flags || {})) if (v) flagged[k] = (flagged[k] || 0) + 1;
      const at = l.at?.toMillis?.();
      if (at) hourly[23 - Math.min(23, Math.floor((Date.now() - at) / 3_600_000))]++;
    }
    res.json({
      store: storeHealth(), policy: AI_POLICY_VERSION, flags,
      ceiling: settings.caps.dailyTokenCeiling, tokensToday: global.exists ? global.get('tokens') || 0 : 0, callsToday: global.exists ? global.get('calls') || 0 : 0,
      last24h: { calls: logSnap.size, errors, tokens, activeExplorers: users.size, byTask, flagged, hourly, truncated: logSnap.size >= 2000 },
      queues: { review: queue.data().count, reported: reported.data().count, letters: letterReports.data().count, contentReports: contentReports.data().count },
      postsToday: postsToday.data().count,
    });
  }));

  // ---------------------------------------------------------------- switches, allowances and AI settings
  router.get('/flags', wrap(async (req, res) => res.json(await getFlags())));
  router.put('/flags', wrap(async (req, res) => {
    const patch = validateFlags(req.body || {});
    const next = await saveSection('flags', patch, req.admin);
    await audit(req.admin, 'flags.update', patch);
    res.json(next);
  }));
  router.get('/settings', wrap(async (req, res) => res.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS })));
  router.put('/settings', wrap(async (req, res) => {
    const patch = validateSettings(req.body || {});
    const next = await saveSection('settings', patch, req.admin);
    // Long texts are recorded by size in the audit log; full versions live in history
    const summary = JSON.parse(JSON.stringify(patch, (k, v) => (typeof v === 'string' && v.length > 200 ? `[${v.length} characters]` : v)));
    await audit(req.admin, 'settings.update', summary);
    res.json(next);
  }));
  router.get('/history/:kind', wrap(async (req, res) => {
    const kind = req.params.kind === 'flags' ? 'flags' : 'settings';
    res.json({ items: plain(await listHistory(kind, 40)) });
  }));
  router.post('/history/:kind/:id/rollback', wrap(async (req, res) => {
    const kind = req.params.kind === 'flags' ? 'flags' : 'settings';
    if (!ID_RE.test(req.params.id)) throw new Error('Bad version');
    const snap = await db().doc(`admin_private/history/${kind}/${req.params.id}`).get();
    if (!snap.exists) throw Object.assign(new Error('Version not found'), { status: 404 });
    const before = { ...(snap.get('before') || {}) };
    delete before.updatedAt; delete before.updatedBy;
    const patch = kind === 'flags' ? validateFlags(before) : validateSettings(before);
    const next = await saveSection(kind, patch, req.admin);
    await audit(req.admin, `${kind}.rollback`, { to: req.params.id });
    res.json(next);
  }));

  // ---------------------------------------------------------------- AI monitor
  router.get('/ai-log', wrap(async (req, res) => {
    let q = db().collection('ai_log');
    if (req.query.uid && ID_RE.test(String(req.query.uid))) q = q.where('uid', '==', String(req.query.uid));
    if (req.query.task && /^[a-z-]{2,20}$/.test(String(req.query.task))) q = q.where('task', '==', String(req.query.task));
    const n = Math.min(200, Number(req.query.limit) || 50);
    let query = q.orderBy('at', 'desc');
    if (req.query.before) query = query.where('at', '<', Timestamp.fromMillis(Number(req.query.before)));
    const snap = await query.limit(n).get();
    let items = snap.docs.map(docOut);
    if (req.query.flagged === '1') items = items.filter(i => i.status >= 400 || Object.values(i.flags || {}).some(Boolean) || i.blockReason || (i.finishReason && i.finishReason !== 'STOP'));
    res.json({ items, before: snap.size === n ? snap.docs[snap.size - 1].get('at')?.toMillis?.() : null });
  }));
  router.get('/usage', wrap(async (req, res) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day || '')) ? String(req.query.day) : today();
    const snap = await db().collection('ai_usage').where('day', '==', day).limit(1000).get();
    const items = snap.docs.map(docOut).sort((a, b) => ((b.identify || 0) + (b.other || 0) + (b.liveMs || 0) / 60_000 + (b.posts || 0)) - ((a.identify || 0) + (a.other || 0) + (a.liveMs || 0) / 60_000 + (a.posts || 0)));
    res.json({ day, explorers: items.length, items: items.slice(0, 100) });
  }));
  router.get('/ai-quality', wrap(async (req, res) => {
    const snap = await db().collection('ai_feedback').orderBy('createdAt', 'desc').limit(Math.min(1000, Number(req.query.limit) || 500)).get();
    res.json({ items: snap.docs.map(docOut) });
  }));

  // ---------------------------------------------------------------- content review
  router.get('/review', wrap(async (req, res) => {
    const snap = await db().collection('review_queue').where('status', '==', 'open').orderBy('createdAt', 'asc').limit(50).get();
    res.json({ items: snap.docs.map(docOut) });
  }));
  router.post('/review/:postId', wrap(async (req, res) => {
    const id = req.params.postId; if (!ID_RE.test(id)) throw new Error('Bad post');
    const action = req.body?.action; if (!['approve', 'reject'].includes(action)) throw new Error('Choose approve or reject');
    const d = db();
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : null;
    const qsnap = await d.doc(`review_queue/${id}`).get();

    // A field note (comment) held by the word check: approve shows it, reject keeps it hidden
    if (qsnap.exists && qsnap.get('kind') === 'comment') {
      const { postId, commentId } = qsnap.data();
      if (!ID_RE.test(String(postId)) || !ID_RE.test(String(commentId))) throw new Error('Bad comment');
      const cref = d.doc(`ecosystem_feed/${postId}/comments/${commentId}`);
      const batch = d.batch();
      const csnap = await cref.get();
      if (csnap.exists) batch.update(cref, action === 'approve'
        ? { hidden: false, moderation: { status: 'clear', reviewedBy: req.admin.uid, at: FieldValue.serverTimestamp() } }
        : { hidden: true, moderation: { status: 'rejected', reasons: csnap.get('moderation.reasons') || [], reviewedBy: req.admin.uid, at: FieldValue.serverTimestamp() } });
      batch.set(qsnap.ref, { status: action === 'approve' ? 'approved' : 'rejected', decidedAt: FieldValue.serverTimestamp(), decidedBy: req.admin.uid, note }, { merge: true });
      await batch.commit();
      await audit(req.admin, `review.comment.${action}`, { postId, commentId });
      return res.json({ ok: true });
    }

    const ref = d.doc(`ecosystem_feed/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw Object.assign(new Error('Post not found'), { status: 404 });
    const post = snap.data(); const batch = d.batch();
    const alreadyPublic = qsnap.exists && qsnap.get('kind') === 'unchecked' && post.isPublic === true;
    if (action === 'approve' && alreadyPublic) {
      // Published while the image check was down; the admin has now looked at it
      batch.update(ref, { moderation: { status: 'clear', imageChecked: false, reviewedBy: req.admin.uid, at: FieldValue.serverTimestamp() } });
      batch.set(d.doc(`review_queue/${id}`), { status: 'approved', decidedAt: FieldValue.serverTimestamp(), decidedBy: req.admin.uid, note }, { merge: true });
      await batch.commit();
      await audit(req.admin, 'review.approve', { postId: id, userId: post.userId, kind: 'unchecked' });
      return res.json({ ok: true });
    }
    if (action === 'approve') {
      const toFeed = qsnap.exists ? qsnap.get('requestedFeed') === true : false;
      batch.update(ref, { moderation: { status: 'clear', reviewedBy: req.admin.uid, at: FieldValue.serverTimestamp() }, isPublic: toFeed });
      if (toFeed) batch.set(d.doc(`feed_thumbnails/${id}`), thumbnailOf(id, { ...post, isPublic: true }));
    } else {
      batch.update(ref, { moderation: { status: 'rejected', reasons: post.moderation?.reasons || [], note, reviewedBy: req.admin.uid, at: FieldValue.serverTimestamp() }, isPublic: false });
      batch.delete(d.doc(`feed_thumbnails/${id}`));
    }
    batch.set(d.doc(`review_queue/${id}`), { status: action === 'approve' ? 'approved' : 'rejected', decidedAt: FieldValue.serverTimestamp(), decidedBy: req.admin.uid, note }, { merge: true });
    batch.set(d.collection(`users/${post.userId}/notifications`).doc(), {
      type: 'review', isRead: false, postId: id, senderId: 'naturegram', senderName: 'NatureGram', timestamp: FieldValue.serverTimestamp(),
      message: action === 'approve' ? 'Your sighting was reviewed and is ready.' : `Your sighting stays in your journal.${note ? ` ${note}` : ''}`.slice(0, 300),
    });
    await batch.commit();
    await audit(req.admin, `review.${action}`, { postId: id, userId: post.userId });
    res.json({ ok: true });
  }));
  router.get('/reported', wrap(async (req, res) => {
    const snap = await db().collection('ecosystem_feed').where('reportStatus', '==', 'pending').limit(50).get();
    const items = await Promise.all(snap.docs.map(async (doc) => {
      const reps = await doc.ref.collection('reports').limit(20).get();
      return { ...docOut(doc), reportReasons: reps.docs.map(r => ({ by: r.id, ...plain(r.data()) })) };
    }));
    res.json({ items });
  }));
  router.post('/posts/:id', wrap(async (req, res) => {
    const id = req.params.id; if (!ID_RE.test(id)) throw new Error('Bad post');
    const action = req.body?.action; if (!['hide', 'restore', 'dismiss', 'delete'].includes(action)) throw new Error('Unknown action');
    const d = db(); const ref = d.doc(`ecosystem_feed/${id}`); const snap = await ref.get();
    if (!snap.exists) throw Object.assign(new Error('Post not found'), { status: 404 });
    const post = snap.data(); const batch = d.batch();
    if (action === 'hide') { batch.update(ref, { reportStatus: 'hidden', isPublic: false }); batch.delete(d.doc(`feed_thumbnails/${id}`)); }
    if (action === 'restore') { batch.update(ref, { reportStatus: 'safe', isPublic: true, moderation: { status: 'clear', reviewedBy: req.admin.uid, at: FieldValue.serverTimestamp() } }); batch.set(d.doc(`feed_thumbnails/${id}`), thumbnailOf(id, { ...post, isPublic: true })); }
    if (action === 'dismiss') batch.update(ref, { reportStatus: 'safe', reports: FieldValue.delete() });
    if (action === 'delete') { batch.delete(ref); batch.delete(d.doc(`feed_thumbnails/${id}`)); }
    await batch.commit();
    await audit(req.admin, `post.${action}`, { postId: id, userId: post.userId });
    res.json({ ok: true });
  }));

  // Reports used to add the reporter's uid to a public `reports` list on the post. Removes that list from
  // every post (reports themselves stay in each post's private reports/ sub-collection, and the queue uses
  // reportStatus / reportCount). Idempotent and batched; a long run returns `next` to continue from.
  router.post('/clear-reporter-ids', wrap(async (req, res) => {
    const d = db();
    const started = Date.now();
    const budgetMs = Math.min(50_000, Math.max(2_000, Number(req.body?.budgetMs) || 45_000));
    let after = String(req.body?.after || '');
    if (after && !ID_RE.test(after)) throw new Error('Bad cursor');
    let scanned = 0; let cleared = 0; let next = null;
    for (;;) {
      let q = d.collection('ecosystem_feed').orderBy(FieldPath.documentId()).select('reports').limit(400);
      if (after) q = q.startAfter(after);
      const snap = await q.get();
      scanned += snap.size;
      const batch = d.batch(); let n = 0;
      for (const doc of snap.docs) {
        if (doc.get('reports') !== undefined) { batch.update(doc.ref, { reports: FieldValue.delete() }); n++; }
      }
      if (n) await batch.commit();
      cleared += n;
      if (snap.size < 400) { next = null; break; }
      after = snap.docs[snap.size - 1].id;
      if (Date.now() - started > budgetMs) { next = after; break; }
    }
    await audit(req.admin, 'reports.clearReporterIds', { scanned, cleared, done: !next });
    res.json({ ok: true, scanned, cleared, next, done: !next });
  }));

  // Reports on field notes and profiles (content_reports), newest first; reporter ids are shown to the admin only
  router.get('/content-reports', wrap(async (req, res) => {
    const status = req.query.status === 'closed' ? 'closed' : 'open';
    const snap = await db().collection('content_reports').where('status', '==', status).limit(100).get();
    const items = snap.docs.map(docOut).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    // The field note's words, so the admin can decide without opening the post
    const notes = await Promise.all(items.map(async (r) => {
      if (r.kind !== 'comment' || !ID_RE.test(String(r.postId)) || !ID_RE.test(String(r.commentId))) return null;
      const c = await db().doc(`ecosystem_feed/${r.postId}/comments/${r.commentId}`).get().catch(() => null);
      return c?.exists ? { text: String(c.get('text') || '').slice(0, 1000), userId: c.get('userId') || null, hidden: c.get('hidden') === true } : { missing: true };
    }));
    res.json({ items: items.map((r, i) => (notes[i] ? { ...r, comment: notes[i] } : r)) });
  }));
  router.post('/content-reports/:id', wrap(async (req, res) => {
    const id = req.params.id; if (!/^[cu]_[A-Za-z0-9_-]{3,400}$/.test(id)) throw new Error('Bad report');
    const action = req.body?.action; if (!['close', 'hide-comment'].includes(action)) throw new Error('Choose close or hide-comment');
    const d = db(); const ref = d.doc(`content_reports/${id}`); const snap = await ref.get();
    if (!snap.exists) throw Object.assign(new Error('Report not found'), { status: 404 });
    const r = snap.data(); const batch = d.batch();
    if (action === 'hide-comment') {
      if (r.kind !== 'comment' || !ID_RE.test(String(r.postId)) || !ID_RE.test(String(r.commentId))) throw new Error('Only a field note can be hidden');
      const cref = d.doc(`ecosystem_feed/${r.postId}/comments/${r.commentId}`);
      if ((await cref.get()).exists) batch.update(cref, { hidden: true, moderation: { status: 'rejected', reasons: ['reported'], reviewedBy: req.admin.uid, at: FieldValue.serverTimestamp() } });
    }
    batch.update(ref, { status: 'closed', closedBy: req.admin.uid, closedAt: FieldValue.serverTimestamp(), outcome: action });
    await batch.commit();
    await audit(req.admin, `contentReport.${action}`, { id, kind: r.kind });
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- people
  router.get('/users', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) {
      if (q.includes('@')) {
        const u = await deps.auth().getUserByEmail(q).catch(() => null);
        return res.json({ items: u ? [{ id: u.uid, email: u.email, username: u.displayName || null }] : [] });
      }
      const snap = await db().collection('users').where('usernameLower', '>=', q).where('usernameLower', '<=', q + '').limit(25).get();
      return res.json({ items: snap.docs.map(docOut) });
    }
    res.json(await page('users', req, 'joinedAt'));
  }));
  router.get('/users/:uid', wrap(async (req, res) => {
    const uid = req.params.uid; if (!ID_RE.test(uid)) throw new Error('Bad account');
    const d = db();
    const [authUser, profile, usage, susp, logs, posts] = await Promise.all([
      deps.auth().getUser(uid).catch(() => null), d.doc(`users/${uid}`).get(), d.doc(`ai_usage/${uid}_${today()}`).get(),
      d.doc(`suspended/${uid}`).get(), d.collection('ai_log').where('uid', '==', uid).orderBy('at', 'desc').limit(50).get(),
      d.collection('ecosystem_feed').where('userId', '==', uid).orderBy('timestamp', 'desc').limit(30).get(),
    ]);
    res.json({
      auth: authUser ? {
        uid, email: authUser.email || null, emailVerified: authUser.emailVerified, disabled: authUser.disabled,
        providers: authUser.providerData.map(p => p.providerId), anonymous: authUser.providerData.length === 0,
        created: authUser.metadata.creationTime, lastSignIn: authUser.metadata.lastSignInTime,
        mfa: (authUser.multiFactor?.enrolledFactors || []).length > 0, claims: authUser.customClaims || {},
      } : null,
      profile: profile.exists ? plain(profile.data()) : null,
      usageToday: usage.exists ? plain(usage.data()) : {},
      suspended: susp.exists ? plain(susp.data()) : null,
      aiLog: logs.docs.map(docOut), posts: posts.docs.map(docOut),
    });
  }));
  router.post('/users/:uid/suspend', wrap(async (req, res) => {
    const uid = req.params.uid; if (!ID_RE.test(uid)) throw new Error('Bad account');
    if (uid === req.admin.uid) throw new Error('You cannot suspend your own account');
    const reason = String(req.body?.reason || '').slice(0, 300);
    await db().doc(`suspended/${uid}`).set({ reason, by: req.admin.uid, at: FieldValue.serverTimestamp() });
    await deps.auth().revokeRefreshTokens(uid).catch(() => {});
    refreshSuspended();
    await audit(req.admin, 'user.suspend', { uid, reason });
    res.json({ ok: true });
  }));
  router.post('/users/:uid/unsuspend', wrap(async (req, res) => {
    const uid = req.params.uid; if (!ID_RE.test(uid)) throw new Error('Bad account');
    await db().doc(`suspended/${uid}`).delete();
    refreshSuspended();
    await audit(req.admin, 'user.unsuspend', { uid });
    res.json({ ok: true });
  }));
  router.post('/users/:uid/signout', wrap(async (req, res) => {
    const uid = req.params.uid; if (!ID_RE.test(uid)) throw new Error('Bad account');
    await deps.auth().revokeRefreshTokens(uid);
    await audit(req.admin, 'user.signout', { uid });
    res.json({ ok: true });
  }));
  router.post('/networks/block', wrap(async (req, res) => {
    const prefix = String(req.body?.prefix || '').trim();
    const settings = await getSettings();
    const list = Array.from(new Set([...(settings.blockedNetworks || []), prefix]));
    const patch = validateSettings({ blockedNetworks: list });
    await saveSection('settings', patch, req.admin);
    await audit(req.admin, 'network.block', { prefix });
    res.json({ ok: true, blockedNetworks: list });
  }));
  router.post('/networks/unblock', wrap(async (req, res) => {
    const prefix = String(req.body?.prefix || '').trim();
    const settings = await getSettings();
    const list = (settings.blockedNetworks || []).filter(p => p !== prefix);
    await saveSection('settings', { blockedNetworks: list }, req.admin);
    await audit(req.admin, 'network.unblock', { prefix });
    res.json({ ok: true, blockedNetworks: list });
  }));

  // ---------------------------------------------------------------- letters: reported conversations only
  router.get('/letters/reported', wrap(async (req, res) => {
    const snap = await db().collection('letter_reports').where('status', '==', 'open').orderBy('createdAt', 'desc').limit(50).get();
    res.json({ items: snap.docs.map(docOut) });
  }));
  router.get('/letters/:cid', wrap(async (req, res) => {
    const cid = req.params.cid; if (!/^[A-Za-z0-9]{1,128}_[A-Za-z0-9]{1,128}$/.test(cid)) throw new Error('Bad conversation');
    const d = db();
    const reports = await d.collection('letter_reports').where('cid', '==', cid).limit(1).get();
    if (reports.empty) throw Object.assign(new Error('Letters can only be read when someone has reported the conversation.'), { status: 403 });
    const msgs = await d.collection(`conversations/${cid}/messages`).orderBy('createdAt', 'desc').limit(100).get();
    await audit(req.admin, 'letters.read', { cid });
    res.json({ items: msgs.docs.map(docOut).reverse() });
  }));
  router.post('/letters/:cid/close', wrap(async (req, res) => {
    const cid = req.params.cid; if (!/^[A-Za-z0-9_]{3,260}$/.test(cid)) throw new Error('Bad conversation');
    const d = db();
    const reports = await d.collection('letter_reports').where('cid', '==', cid).where('status', '==', 'open').limit(50).get();
    const batch = d.batch();
    reports.docs.forEach(r => batch.update(r.ref, { status: 'closed', closedBy: req.admin.uid, closedAt: FieldValue.serverTimestamp() }));
    await batch.commit();
    await audit(req.admin, 'letters.close', { cid });
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- data explorer (read only)
  router.get('/explore/:collection', wrap(async (req, res) => {
    const name = req.params.collection;
    if (!(name in EXPLORABLE)) throw Object.assign(new Error('That collection is not available here.'), { status: 404 });
    const n = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const field = EXPLORABLE[name];
    let q = db().collection(name);
    if (req.query.where && req.query.equals !== undefined && /^[A-Za-z0-9_.]{1,60}$/.test(String(req.query.where))) {
      const raw = String(req.query.equals);
      const v = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      q = q.where(String(req.query.where), '==', v);
    } else if (field) {
      q = q.orderBy(field, 'desc');
    }
    if (req.query.after && ID_RE.test(String(req.query.after))) {
      const cursor = await db().doc(`${name}/${req.query.after}`).get();
      if (cursor.exists) q = q.startAfter(cursor);
    }
    const snap = await q.limit(n).get();
    res.json({ items: snap.docs.map(docOut), next: snap.size === n ? snap.docs[snap.size - 1].id : null });
  }));
  router.get('/explore/:collection/:id', wrap(async (req, res) => {
    const name = req.params.collection;
    if (!(name in EXPLORABLE) || !ID_RE.test(req.params.id)) throw Object.assign(new Error('Not available'), { status: 404 });
    const snap = await db().doc(`${name}/${req.params.id}`).get();
    if (!snap.exists) throw Object.assign(new Error('Not found'), { status: 404 });
    res.json(docOut(snap));
  }));

  // ---------------------------------------------------------------- audit and security
  router.get('/audit', wrap(async (req, res) => {
    let q = db().collection('admin_audit').orderBy('at', 'desc');
    if (req.query.before) q = q.where('at', '<', Timestamp.fromMillis(Number(req.query.before)));
    const snap = await q.limit(100).get();
    res.json({ items: snap.docs.map(docOut), before: snap.size === 100 ? snap.docs[99].get('at')?.toMillis?.() : null });
  }));
  router.get('/security', wrap(async (req, res) => {
    // Every account holding the admin claim (should be exactly one)
    const holders = [];
    let token;
    let scanned = 0;
    do {
      const pageRes = await deps.auth().listUsers(1000, token);
      scanned += pageRes.users.length;
      for (const u of pageRes.users) if (u.customClaims?.admin === true) holders.push({ uid: u.uid, email: u.email || null, mfa: (u.multiFactor?.enrolledFactors || []).length > 0, lastSignIn: u.metadata.lastSignInTime });
      token = pageRes.pageToken;
    } while (token && scanned < 20_000);
    const settings = await getSettings();
    res.json({
      adminHolders: holders, scanned, namedAdmin: ADMIN_UIDS.length ? { uids: ADMIN_UIDS } : { email: ADMIN_EMAIL },
      requireAdminMfa: settings.requireAdminMfa, sessionHours: SESSION_HOURS,
      blockedNetworks: settings.blockedNetworks, store: storeHealth(),
      env: {
        serviceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT), quotaFailOpen: process.env.QUOTA_FAIL_OPEN === 'true',
        appCheck: deps.status?.().appCheck?.mode || 'monitoring',
      },
      runtime: deps.status?.() || null,
    });
  }));

  // ---------------------------------------------------------------- experiments and feature flags (config/flags)
  router.get('/experiments', wrap(async (req, res) => {
    const snap = await db().doc('config/flags').get();
    res.json({ flags: snap.exists ? (snap.get('flags') || {}) : {}, updatedAt: snap.exists ? plain(snap.get('updatedAt')) : null });
  }));
  router.put('/experiments', wrap(async (req, res) => {
    const flags = validateExperiments(req.body?.flags);
    const ref = db().doc('config/flags');
    const before = (await ref.get()).data() || {};
    await db().collection('admin_private/history/experiments').add({ before, patch: { flags }, by: req.admin.uid, email: req.admin.email, at: FieldValue.serverTimestamp() });
    // Whole map replaced, so a removed flag really goes away (set, not merge)
    await ref.set({ flags, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.admin.uid });
    await audit(req.admin, 'experiments.update', { names: Object.keys(flags) });
    res.json({ flags });
  }));

  // ---------------------------------------------------------------- branding (config/branding, publicly readable)
  // The favicon / home-screen mark: the landing sun by default, following the naturalist's colours.
  const HEXC = /^#[0-9a-f]{6}$/i;
  const validateBranding = (b) => {
    const out = { style: 'sun', colorMode: 'naturalist', fixed: null, customIcon: null };
    if (!b || typeof b !== 'object') return out;
    if (['sun', 'lens', 'custom'].includes(b.style)) out.style = b.style;
    if (b.colorMode === 'fixed') {
      const f = b.fixed || {};
      if (!HEXC.test(f.ground || '')) throw Object.assign(new Error('Pick a background colour as #rrggbb.'), { status: 400 });
      out.colorMode = 'fixed';
      out.fixed = { ground: f.ground, ground2: HEXC.test(f.ground2 || '') ? f.ground2 : f.ground, ink: HEXC.test(f.ink || '') ? f.ink : '#ffffff' };
    }
    if (out.style === 'custom') {
      const icon = String(b.customIcon || '');
      // PNG or WebP only (never SVG, which can carry script), and small enough for a favicon
      if (!/^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(icon)) throw Object.assign(new Error('Upload a PNG or WebP image.'), { status: 400 });
      if (icon.length > 210_000) throw Object.assign(new Error('That image is too large. Keep it under 150 KB (512 × 512 is plenty).'), { status: 400 });
      out.customIcon = icon;
    }
    return out;
  };
  router.get('/branding', wrap(async (req, res) => {
    const snap = await db().doc('config/branding').get();
    const d = snap.exists ? snap.data() : {};
    res.json({ branding: { style: d.style || 'sun', colorMode: d.colorMode || 'naturalist', fixed: d.fixed || null, customIcon: d.customIcon || null }, updatedAt: snap.exists ? plain(d.updatedAt) : null });
  }));
  router.put('/branding', express.json({ limit: '400kb' }), wrap(async (req, res) => {
    const branding = validateBranding(req.body?.branding);
    const ref = db().doc('config/branding');
    const before = (await ref.get()).data() || {};
    const { customIcon: _drop, ...beforeLite } = before;
    await db().collection('admin_private/history/branding').add({ before: beforeLite, hadCustomIcon: Boolean(before.customIcon), patch: { ...branding, customIcon: branding.customIcon ? '(image)' : null }, by: req.admin.uid, email: req.admin.email, at: FieldValue.serverTimestamp() });
    await ref.set({ ...branding, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.admin.uid });
    await audit(req.admin, 'branding.update', { style: branding.style, colorMode: branding.colorMode });
    res.json({ branding });
  }));

  // ---------------------------------------------------------------- search keys backfill (idempotent, batched)
  router.post('/backfill/search-tokens', wrap(async (req, res) => {
    const d = db();
    const size = Math.min(400, Math.max(10, Number(req.body?.limit) || 200));
    let q = d.collection('ecosystem_feed').orderBy(FieldPath.documentId()).limit(size);
    const after = String(req.body?.after || '');
    if (after) { if (!ID_RE.test(after)) throw new Error('Bad cursor'); q = q.startAfter(after); }
    const snap = await q.get();
    const thumbRefs = snap.docs.map(doc => d.doc(`feed_thumbnails/${doc.id}`));
    const thumbs = thumbRefs.length ? await d.getAll(...thumbRefs) : [];
    const batch = d.batch(); let updated = 0;
    snap.docs.forEach((doc, i) => {
      const p = doc.data();
      const tokens = searchTokensFor(p);
      if (!sameTokens(tokens, p.searchTokens)) { batch.update(doc.ref, { searchTokens: tokens }); updated++; }
      const t = thumbs[i];
      if (t?.exists && !sameTokens(tokens, t.get('searchTokens'))) batch.update(t.ref, { searchTokens: tokens });
    });
    if (updated || thumbs.some(t => t.exists)) await batch.commit();
    const next = snap.size === size ? snap.docs[snap.size - 1].id : null;
    if (!next) await audit(req.admin, 'backfill.searchTokens.done', {});
    res.json({ processed: snap.size, updated, next });
  }));

  // ---------------------------------------------------------------- Darwin Core Archive (GBIF) export
  router.get('/export/dwc.zip', wrap(async (req, res) => {
    const d = db();
    const publicHost = process.env.PUBLIC_HOST || 'thenaturegram.com';
    const MAX = Math.min(50_000, Number(req.query.max) || 20_000);
    const lines = [csvHeader()];
    const profiles = new Map();
    let cursor = null; let scanned = 0; let skipped = 0;
    while (lines.length - 1 < MAX) {
      let q = d.collection('ecosystem_feed').where('isPublic', '==', true).orderBy(FieldPath.documentId()).limit(300);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      cursor = snap.docs[snap.size - 1].id;
      scanned += snap.size;
      const rows = snap.docs.filter(doc => exportable(doc.id, doc.data()) && namesOf(doc.data()).scientific);
      skipped += snap.size - rows.length;
      const needProfiles = [...new Set(rows.map(r => r.get('userId')).filter(u => u && ID_RE.test(u) && !profiles.has(u)))];
      if (needProfiles.length) (await d.getAll(...needProfiles.map(u => d.doc(`users/${u}`)))).forEach((s, i) => profiles.set(needProfiles[i], s.exists ? s.data() : null));
      const wantCoords = rows.filter(r => r.get('showLocation') === true && r.get('aiFlags.sensitiveSpecies') !== true && ID_RE.test(String(r.get('userId') || '')));
      const coordSnaps = wantCoords.length ? await d.getAll(...wantCoords.map(r => d.doc(`users/${r.get('userId')}/private/obs_${r.id}`))) : [];
      const coords = new Map(coordSnaps.map((s, i) => [wantCoords[i].id, s.exists ? (s.get('rawLocations') || []).find(Boolean) || null : null]));
      for (const doc of rows) {
        const p = doc.data();
        let verified = typeof p.communityVerified === 'boolean' ? p.communityVerified : null;
        if (verified === null) {
          const ids = await doc.ref.collection('identifications').limit(50).get();
          const primary = String(p.labels?.[0] || '').trim().toLowerCase();
          verified = ids.docs.filter(x => String(x.get('name') || '').trim().toLowerCase() === primary).length >= 2;
        }
        const row = occurrenceRow(doc.id, p, { publicHost, coords: coords.get(doc.id) || null, profile: profiles.get(p.userId) || null, verified });
        if (row) lines.push(csvLine(row)); else skipped++;
        if (lines.length - 1 >= MAX) break;
      }
      if (snap.size < 300) break;
    }
    const count = lines.length - 1;
    const archive = zip([
      { name: 'occurrence.csv', data: lines.join('\n') + '\n' },
      { name: 'meta.xml', data: metaXml() },
      { name: 'eml.xml', data: emlXml({ publicHost, count, contactEmail: process.env.DWC_CONTACT_EMAIL || '' }) },
    ]);
    await audit(req.admin, 'export.dwc', { count, scanned, skipped });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="naturegram-dwca-${today()}.zip"`);
    res.setHeader('X-Export-Count', String(count));
    res.setHeader('X-Export-Skipped', String(skipped));
    res.end(archive);
  }));

  app.use('/api/admin', router);
}
