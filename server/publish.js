/**
 * Publishing goes through the server, so every sighting gets the same checks with no exceptions:
 *
 *  1. Signed-in member (not a guest), not suspended, network not blocked, uploads switched on.
 *  2. Media must already be in the explorer's own storage folders (no outside links).
 *  3. Captions, titles, notes and tags carry no links, contact details or promotions.
 *  4. Each photo (or video poster) is checked for people, faces, number plates and screens,
 *     and for whether a plant, animal, fungus or natural sound is the subject. A held capture
 *     comes back with words that say how to fix it. The explorer can instead ask for a review:
 *     the sighting is saved to their journal and the admin decides.
 *  5. The guide's words on a post are only the words the guide actually returned
 *     (looked up by ngResultId), never text sent from the phone.
 *  6. The daily post allowance (same for everyone, set by the admin) is charged last.
 *
 * Writes use the Admin SDK; the database rules stop clients creating posts directly.
 */
import https from 'https';
import express from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFlags, getSettings } from './settings.js';
import { charge, usageFor, logAi, addGlobalTokens } from './ledger.js';
import { moderationBody, policyText, findPolicyBreach } from './aiGovernance.js';
import { textFlags } from './moderationText.js';
import { searchTokensFor } from './searchTokens.js';
import { appCheckMiddleware } from './appCheck.js';
import { teenPolicy, graduateIfDue } from './guardian.js';
import { queueIndexNow } from './indexNow.js';
import { previewFields, serverPreview, hasSharp } from './media.js';
import { recomputeUserStats } from './userStats.js';

// When the image check cannot run (model error, timeout), publish normally and queue the sighting
// for an after-the-fact look instead of holding it. MODERATION_FAIL_OPEN=false restores holding.
export const MODERATION_FAIL_OPEN = process.env.MODERATION_FAIL_OPEN !== 'false';
// Privacy problems the explorer can fix (crop or retake) vs safety problems the admin decides
export const PRIVACY_REASONS = ['faces', 'people', 'plates', 'screen', 'notNature'];
export const SAFETY_REASONS = ['unsafe', 'words', 'spam'];
const SAFETY_FINISH = /^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|IMAGE_SAFETY)$/;

const MAX_ITEMS = 10;
const MODERATE_ITEMS = 4;
const SPAM = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|xyz|io|in|co|me|link|site|shop)\b|@[a-z0-9-]+\.[a-z]{2,}|(?:\+?\d[\s-]?){10,}|\b(whatsapp|telegram|dm me|follow me|promo|discount|coupon|giveaway|buy now|free followers)\b/i;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');
const strList = (v, n, max) => (Array.isArray(v) ? v.map(x => str(x, max)).filter(Boolean).slice(0, n) : []);
const numOr = (v, d = null) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The storage path behind a Firebase download URL, or null if it isn't one. */
export function storagePathOf(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return null;
    if (u.hostname === 'firebasestorage.googleapis.com') {
      const m = /^\/v0\/b\/[^/]+\/o\/(.+)$/.exec(u.pathname);
      return m ? decodeURIComponent(m[1]) : null;
    }
    if (u.hostname === 'storage.googleapis.com') {
      const m = /^\/[^/]+\/(.+)$/.exec(u.pathname);
      return m ? decodeURIComponent(m[1]) : null;
    }
  } catch { /* not a URL */ }
  return null;
}

/**
 * Storage paths of a post's clips and recordings (post and items). The poster function finds the
 * posts that use a clip by this list (array-contains), so it is written on every new post.
 */
export function mediaPathsOf(post) {
  const p = post && typeof post === 'object' ? post : {};
  const out = new Set();
  for (const i of [p, ...(Array.isArray(p.items) ? p.items : [])]) {
    for (const u of [i?.videoUrl, i?.audioUrl]) {
      const path = u ? storagePathOf(u) : null;
      if (path && !path.includes('..') && /^(videos|audio|drafts)\/[^/]+\/[^/]+$/.test(path)) out.add(path);
    }
  }
  return [...out].slice(0, 24);
}

/** Media may only come from the explorer's own folders. */
export function ownMedia(url, uid, kinds) {
  if (url == null || url === '') return true;
  const p = storagePathOf(url);
  if (!p || p.includes('..')) return false;
  return kinds.some(k => p.startsWith(`${k}/${uid}/`));
}

/** When the photo was taken (EXIF), only if it is after 1990 and in the past. */
const MIN_OBSERVED_MS = Date.UTC(1990, 0, 1);
export function observedAtOf(ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  if (ms <= MIN_OBSERVED_MS || ms > now) return null;
  return Timestamp.fromMillis(Math.round(ms));
}

export const textBreach =(...texts) => texts.some(t => t && SPAM.test(String(t)));

function cleanItem(it, uid) {
  const i = it && typeof it === 'object' ? it : {};
  for (const k of ['imageUrl', 'originalImageUrl']) if (!ownMedia(i[k], uid, ['snapshots'])) throw Object.assign(new Error('media'), { code: 'media' });
  // A clip's still may be the one the poster function made beside it in videos/
  for (const k of ['thumbnailUrl', 'thumbSmallUrl']) if (!ownMedia(i[k], uid, ['snapshots', 'videos'])) throw Object.assign(new Error('media'), { code: 'media' });
  if (!ownMedia(i.videoUrl, uid, ['videos'])) throw Object.assign(new Error('media'), { code: 'media' });
  if (!ownMedia(i.audioUrl, uid, ['audio', 'videos'])) throw Object.assign(new Error('media'), { code: 'media' });
  const assoc = Array.isArray(i.associatedImageUrls) ? i.associatedImageUrls.slice(0, 8) : [];
  if (!assoc.every(u => ownMedia(u, uid, ['snapshots']))) throw Object.assign(new Error('media'), { code: 'media' });
  const mediaType = ['image', 'video', 'audio'].includes(i.mediaType) ? i.mediaType : 'image';
  return {
    imageUrl: i.imageUrl || null, thumbnailUrl: i.thumbnailUrl || null, thumbSmallUrl: i.thumbSmallUrl || null,
    originalImageUrl: i.originalImageUrl || null, videoUrl: i.videoUrl || null, audioUrl: i.audioUrl || null,
    associatedImageUrls: assoc, mediaType,
    // Blur-up preview, main colour and size, made on the phone (checked: small data URL, hex, integers)
    ...previewFields(i, mediaType),
    labels: strList(i.labels, 12, 80),
    behavior: str(i.behavior, 1000) || 'Observation.',
    showLocation: i.showLocation === true,
    locationArea: i.showLocation === true ? str(i.locationArea, 120) : '',
    rotation: [0, 90, 180, 270].includes(i.rotation) ? i.rotation : 0,
    timeToRecordMs: numOr(i.timeToRecordMs),
    humanDelta: i.humanDelta === true,
    sessionRetakes: numOr(i.sessionRetakes),
    aiResultId: typeof i.aiResultId === 'string' && /^[A-Za-z0-9]{10,40}$/.test(i.aiResultId) ? i.aiResultId : null,
    // Field notes as the explorer signed them off (may be the guide's words, edited or not)
    aiInsight: str(i.aiInsight, 2000) || null,
    // Filled from the server's own record of what the guide said:
    aiConfidence: null, aiProposedLabels: null, aiModel: null, aiInsightEdited: false,
    // From the phone, only flags that make things stricter are believed
    aiFlags: { sensitiveSpecies: i.aiFlags?.sensitiveSpecies === true, peopleVisible: i.aiFlags?.peopleVisible === true, isNatureSubject: i.aiFlags?.isNatureSubject !== false },
    needsExpertReview: i.needsExpertReview === true,
    observedAt: observedAtOf(i.takenAtMs),
  };
}

function fetchImage(url, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15_000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`media ${res.statusCode}`)); }
      const type = String(res.headers['content-type'] || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) { res.resume(); return reject(new Error('not an image')); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { req.destroy(new Error('too large')); return; } chunks.push(c); });
      res.on('end', () => resolve({ data: Buffer.concat(chunks).toString('base64'), mimeType: type }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function callModel({ apiKey, targetHost, publicHost }, model, body) {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: targetHost, port: 443, method: 'POST', timeout: 30_000,
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'content-type': 'application/json', 'content-length': String(payload.length), 'x-goog-api-key': apiKey, origin: `https://${publicHost}`, referer: `https://${publicHost}/` },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode >= 400) return reject(new Error(`model ${res.statusCode}`));
          // A safety block is an answer, not an error: the image itself tripped the filters
          const blocked = json.promptFeedback?.blockReason || (SAFETY_FINISH.test(String(json.candidates?.[0]?.finishReason || '')) ? json.candidates[0].finishReason : null);
          if (blocked) return resolve({ out: null, blocked: String(blocked), tokens: json.usageMetadata?.totalTokenCount || 0 });
          const text = json.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
          resolve({ out: text ? JSON.parse(text) : null, tokens: json.usageMetadata?.totalTokenCount || 0 });
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

/** Returns { reasons: string[] } or throws when the check could not run. */
async function moderateImages(deps, uid, items, settings) {
  const urls = items.map(i => i.thumbSmallUrl || i.thumbnailUrl || i.imageUrl).filter(Boolean).slice(0, MODERATE_ITEMS);
  const reasons = new Set();
  for (const url of urls) {
    const started = Date.now();
    const img = await fetchImage(url);
    const { out, tokens, blocked } = await callModel(deps, settings.models.moderate, moderationBody(settings, img.data, img.mimeType));
    addGlobalTokens(tokens);
    if (blocked) {
      reasons.add('unsafe');
      logAi({ uid, task: 'moderate', model: settings.models.moderate, status: 200, ms: Date.now() - started, totalTokens: tokens || null, blockReason: blocked, flags: { unsafe: true } });
      continue;
    }
    if (!out) throw new Error('empty moderation answer');
    if (out.unsafe === true) reasons.add('unsafe');
    if (out.people) reasons.add('people');
    if (out.faces) reasons.add('faces');
    if (out.plates) reasons.add('plates');
    if (out.screen) reasons.add('screen');
    if (out.naturalSubject === false) reasons.add('notNature');
    logAi({ uid, task: 'moderate', model: settings.models.moderate, status: 200, ms: Date.now() - started, totalTokens: tokens || null, flags: Object.fromEntries([...reasons].map(r => [r, true])) });
  }
  return { reasons: [...reasons] };
}

export function mountPublish(app, deps) {
  const { verifyIdToken, bearer, gate, clientIp, log } = deps;

  app.post('/api/publish', appCheckMiddleware(log, '/api/publish'), express.json({ limit: '256kb' }), async (req, res) => {
    const say = (status, code, message, extra = {}) => res.status(status).json({ ok: false, code, message, ...extra });
    const db = deps.db();
    if (!db) return say(503, 'unavailable', 'Publishing is unavailable for a moment. Please try again.');

    let user;
    try { user = await verifyIdToken(String(bearer(req))); } catch { return say(401, 'auth', 'Please sign in again.'); }
    if (user.isAnonymous) return say(403, 'guest', 'Create a free account to share sightings.');

    const [flags, settings] = await Promise.all([getFlags(), getSettings()]);
    if (!flags.uploadsEnabled) return say(503, 'paused', 'Sharing is paused right now. Your capture is safe on this device.');
    // Same switches as the AI: blocked networks and suspended accounts. AI being paused doesn't stop publishing.
    const blocked = await gate(user, clientIp(req), { live: false }).then(b => (b && b.status === 403 ? b : null));
    if (blocked) return say(403, 'blocked', blocked.message);

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const g = settings.guidance;
    // Teen mode: until a parent approves, sightings stay in the journal; after, never where
    const profile = await graduateIfDue(db, user.uid, (await db.doc(`users/${user.uid}`).get().catch(() => null))?.data() || {});
    const teen = teenPolicy(profile);

    // Allowance first (read only), so nobody waits through checks they can't use
    const used = await usageFor(user.uid);
    if (used === null) return say(503, 'unavailable', 'Publishing is unavailable for a moment. Please try again.');
    const limit = Math.max(0, Number(flags.allowances.postsPerDay) || 0);
    if ((used.posts || 0) >= limit) return say(429, 'allowance', `You've shared today's ${limit} sightings. Sharing opens again at midnight UTC. Keep this one in your journal until then.`);

    let items;
    try {
      const raw = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
      if (!raw.length) return say(400, 'empty', 'Nothing to share.');
      items = raw.map(i => cleanItem(i, user.uid));
    } catch {
      return say(400, 'media', 'This capture has media from outside NatureGram. Capture it again in the app to share it.');
    }
    if (!items.some(i => i.imageUrl || i.videoUrl || i.audioUrl)) return say(400, 'empty', 'Nothing to share.');

    const caption = str(body.caption, 2200);
    const title = str(body.title, 200);
    const description = str(body.description, 5000);
    const behavior = str(body.behavior, 1000);
    const tags = Array.from(new Set(strList(body.tags, 30, 40).map(t => (t.startsWith('#') ? t : `#${t}`).toLowerCase().replace(/\s+/g, '')))).slice(0, 30);
    if (textBreach(caption, title, description, behavior, ...tags, ...items.flatMap(i => [i.behavior, i.aiInsight, ...i.labels]))) {
      return say(422, 'caption', g.caption, { fix: 'text' });
    }
    if ([caption, title, description, behavior, ...items.flatMap(i => [i.behavior, i.aiInsight])].some(t => findPolicyBreach(t))) {
      return say(422, 'safety', g.safety, { fix: 'text' });
    }

    // The guide's own words, by reference
    await Promise.all(items.map(async (i) => {
      if (!i.aiResultId) return;
      const snap = await db.doc(`ai_results/${i.aiResultId}`).get().catch(() => null);
      const r = snap?.exists ? snap.data() : null;
      if (!r || r.uid !== user.uid) { i.aiResultId = null; return; }
      // Provenance: keep what the guide said and whether the explorer changed it
      i.aiInsightEdited = Boolean(i.aiInsight && r.ecologic && i.aiInsight.trim() !== String(r.ecologic).trim());
      if (!i.aiInsight) i.aiInsight = r.ecologic || null;
      i.aiConfidence = r.confidence || null;
      const f = r.flags || {};
      i.aiFlags = {
        isNatureSubject: f.isNatureSubject !== false && i.aiFlags?.isNatureSubject !== false,
        fungi: !!f.fungi, dangerous: !!f.dangerous,
        sensitiveSpecies: !!f.sensitiveSpecies || !!i.aiFlags?.sensitiveSpecies,
        peopleVisible: !!f.peopleVisible || !!i.aiFlags?.peopleVisible,
      };
      i.aiProposedLabels = Array.isArray(r.labels) ? r.labels : null;
      i.aiModel = r.model || null;
      i.needsExpertReview = i.needsExpertReview || r.confidence === 'low';
    }));
    const sensitive = items.some(i => i.aiFlags?.sensitiveSpecies);
    if (teen.teen) items.forEach(i => { i.locationArea = ''; i.showLocation = false; });
    if (sensitive) items.forEach(i => { i.locationArea = ''; i.showLocation = false; });

    // Words: abuse and spam heuristics (no AI). A hit keeps the sighting out of the feed until reviewed.
    const safety = new Set(textFlags([caption, title, description, behavior, ...tags, ...items.flatMap(i => [i.behavior, i.aiInsight, ...i.labels])], { extraWords: settings.moderationWords || [] }));

    // Image check (once per sighting; re-run only if the picture is edited later)
    let reasons = [];
    let unchecked = false;
    if (items.some(i => i.aiFlags?.isNatureSubject === false)) reasons.push('notNature');
    if (items.some(i => i.aiFlags?.peopleVisible)) reasons.push('people');
    try {
      const m = await moderateImages(deps, user.uid, items, settings);
      for (const r of m.reasons) (SAFETY_REASONS.includes(r) ? safety.add(r) : reasons.push(r));
      reasons = Array.from(new Set(reasons));
    } catch (e) {
      unchecked = true;
      log('warn', 'publish check unavailable', { uid: user.uid, failOpen: MODERATION_FAIL_OPEN, error: String(e.message).slice(0, 120) });
    }
    const safetyReasons = [...safety];

    const wantsFeed = body.feed === true && (!teen.teen || teen.approved);
    const requestReview = body.requestReview === true;
    if (reasons.length && !requestReview) {
      const first = PRIVACY_REASONS.find(r => reasons.includes(r));
      return say(422, first, g[first], { reasons, fix: first === 'notNature' || first === 'screen' ? 'retake' : 'crop', canRequestReview: true });
    }

    // Charge the allowance (atomic, same limit for everyone)
    const charged = await charge(user.uid, 'posts', 1, limit);
    if (charged.unavailable) return say(503, 'unavailable', 'Publishing is unavailable for a moment. Please try again.');
    if (!charged.ok) return say(429, 'allowance', `You've shared today's ${limit} sightings. Sharing opens again at midnight UTC.`);

    // pending: safety flags, the admin decides. held: privacy review the explorer asked for (or an
    // unchecked image when fail-open is off). Unchecked with fail-open: published, queued for a look.
    const pending = safetyReasons.length > 0;
    const held = pending || reasons.length > 0 || (unchecked && !MODERATION_FAIL_OPEN);
    const lookLater = !held && unchecked;
    const primary = items[0];
    // Older apps send no preview: make one here when the server can (sharp installed), never delaying long
    if (!primary.lqip && await hasSharp()) {
      const still = primary.thumbSmallUrl || primary.thumbnailUrl || primary.imageUrl;
      const made = still ? await Promise.race([
        fetchImage(still).then(img => serverPreview(Buffer.from(img.data, 'base64'))),
        new Promise(r => setTimeout(() => r(null), 2500)),
      ]).catch(() => null) : null;
      if (made) Object.assign(primary, Object.fromEntries(Object.entries(made).filter(([k]) => !(k in primary))));
    }
    const preview = previewFields(primary, primary.mediaType);
    const labels = Array.from(new Set(items.flatMap(i => i.labels))).slice(0, 20);
    const post = {
      userId: user.uid,
      userName: str(profile.username, 40) || `Explorer-${user.uid.slice(0, 4)}`,
      userAvatar: profile.avatarUrl || null,
      imageUrl: primary.imageUrl, thumbnailUrl: primary.thumbnailUrl, thumbSmallUrl: primary.thumbSmallUrl,
      originalImageUrl: primary.originalImageUrl, videoUrl: primary.videoUrl, audioUrl: primary.audioUrl,
      associatedImageUrls: primary.associatedImageUrls, mediaType: primary.mediaType,
      ...preview,
      labels,
      behavior: behavior || description || primary.behavior,
      aiInsight: primary.aiInsight, aiConfidence: primary.aiConfidence,
      aiPolicyVersion: policyText(settings).match(/v([\d.-]+)/)?.[1] || null,
      needsExpertReview: items.some(i => i.needsExpertReview),
      aiFlags: {
        isNatureSubject: items.every(i => i.aiFlags?.isNatureSubject !== false),
        fungi: items.some(i => i.aiFlags?.fungi), dangerous: items.some(i => i.aiFlags?.dangerous),
        sensitiveSpecies: sensitive, peopleVisible: items.some(i => i.aiFlags?.peopleVisible),
      },
      locationArea: primary.locationArea, showLocation: primary.showLocation,
      tags, caption: caption || null,
      timestamp: FieldValue.serverTimestamp(),
      likes: [], likeCount: 0, commentCount: 0,
      isPublic: wantsFeed && !held,
      isJournal: body.journal !== false || held || (body.feed === true && !wantsFeed),
      reportStatus: 'safe', reportCount: 0,
      isHybrid: items.length > 1 || items.some(i => i.associatedImageUrls.length > 0),
      items: items.map(({ aiResultId, observedAt, ...rest }) => ({ ...rest, aiResultId, ...(observedAt ? { observedAt } : {}) })),
      ...(items.find(i => i.observedAt) ? { observedAt: items.find(i => i.observedAt).observedAt } : {}),
      rotation: primary.rotation, timeToRecordMs: primary.timeToRecordMs, sessionRetakes: primary.sessionRetakes,
      humanDelta: items.some(i => i.humanDelta),
      moderation: pending
        ? { status: 'pending', reasons: [...safetyReasons, ...reasons], requestedFeed: wantsFeed, imageChecked: !unchecked, at: FieldValue.serverTimestamp() }
        : held
          ? { status: 'held', reasons: unchecked && !reasons.length ? ['unchecked'] : reasons, requestedFeed: wantsFeed, imageChecked: !unchecked, at: FieldValue.serverTimestamp() }
          : { status: 'clear', ...(unchecked ? { unchecked: true } : {}), imageChecked: !unchecked, at: FieldValue.serverTimestamp() },
    };
    post.searchTokens = searchTokensFor({ ...post, title });
    const mediaPaths = mediaPathsOf(post);
    if (mediaPaths.length) post.mediaPaths = mediaPaths;
    if (title) post.title = title;
    if (description) post.description = description;

    const ref = db.collection('ecosystem_feed').doc();
    const batch = db.batch();
    batch.set(ref, post);
    if (post.isPublic) batch.set(db.doc(`feed_thumbnails/${ref.id}`), thumbnailOf(ref.id, post));
    if (held || lookLater) {
      batch.set(db.doc(`review_queue/${ref.id}`), {
        kind: pending ? 'safety' : lookLater ? 'unchecked' : 'privacy',
        postId: ref.id, userId: user.uid, reasons: lookLater ? ['unchecked'] : post.moderation.reasons, requestedFeed: wantsFeed, published: post.isPublic,
        requestedByExplorer: requestReview, note: str(body.reviewNote, 300) || null,
        thumb: primary.thumbSmallUrl || primary.thumbnailUrl || primary.imageUrl || null,
        createdAt: FieldValue.serverTimestamp(), status: 'open',
      });
    }
    const raw = Array.isArray(body.rawLocations) ? body.rawLocations.slice(0, MAX_ITEMS) : [];
    const coords = raw.map(c => (c && numOr(c.lat) !== null && numOr(c.lng) !== null && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180 ? { lat: c.lat, lng: c.lng } : null));
    if (coords.some(Boolean)) batch.set(db.doc(`users/${user.uid}/private/obs_${ref.id}`), { postId: ref.id, rawLocations: coords, createdAt: FieldValue.serverTimestamp() });
    batch.set(db.doc(`users/${user.uid}`), { stats: { observations: FieldValue.increment(items.length) } }, { merge: true });
    try {
      await batch.commit();
    } catch (e) {
      log('error', 'publish write failed', { uid: user.uid, error: String(e.message).slice(0, 160) });
      await charge(user.uid, 'posts', -1, limit).catch(() => {});
      return say(503, 'unavailable', 'Publishing is unavailable for a moment. Please try again.');
    }

    log('info', 'published', { uid: user.uid, postId: ref.id, held, pending, unchecked, reasons: post.moderation.reasons || [] });
    // One true count: species and sightings from public sightings (never delays the explorer)
    if (post.isPublic) recomputeUserStats(db, user.uid, FieldValue).catch(e => log('warn', 'stats recount failed', { uid: user.uid, error: String(e.message).slice(0, 120) }));
    // Search engines hear about a new public sighting at once (never a teen's: they stay out of search)
    if (post.isPublic && !teen.teen) queueIndexNow([`https://${deps.publicHost}/post/${ref.id}`], { host: deps.publicHost, log });
    res.json({
      ok: true, id: ref.id, held, isPublic: post.isPublic,
      url: primary.imageUrl || undefined, videoUrl: primary.videoUrl || undefined, audioUrl: primary.audioUrl || undefined,
      message: teen.teen && !teen.approved ? 'Saved to your journal. Sharing opens once a grown-up says yes.' : held ? 'Saved to your journal. It will appear in the feed once it has been reviewed.' : undefined,
      note: sensitive ? g.sensitive : undefined,
      left: Math.max(0, limit - charged.used),
    });
  });

  // Share a journal-only sighting to the feed later (only one that passed the checks)
  app.post('/api/posts/:id/visibility', appCheckMiddleware(log, '/api/posts/visibility'), express.json({ limit: '4kb' }), async (req, res) => {
    const db = deps.db();
    if (!db) return res.status(503).json({ ok: false, message: 'Unavailable for a moment.' });
    let user;
    try { user = await verifyIdToken(String(bearer(req))); } catch { return res.status(401).json({ ok: false, message: 'Please sign in again.' }); }
    const id = String(req.params.id || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return res.status(400).json({ ok: false, message: 'Bad request' });
    const ref = db.doc(`ecosystem_feed/${id}`);
    const snap = await ref.get();
    const post = snap.exists ? snap.data() : null;
    if (!post || post.userId !== user.uid) return res.status(404).json({ ok: false, message: 'Not found' });
    const makePublic = req.body?.isPublic === true;
    let recheck = null;
    const teen = makePublic ? teenPolicy(await graduateIfDue(db, user.uid, (await db.doc(`users/${user.uid}`).get().catch(() => null))?.data() || {})) : { teen: false };
    if (makePublic && teen.teen && !teen.approved) return res.status(403).json({ ok: false, code: 'guardian', message: 'Sharing opens once a grown-up says yes. Your sighting is safe in your journal.' });
    if (makePublic) {
      // Every picture, clip and sound must still be the explorer's own upload
      const urls = [post, ...(Array.isArray(post.items) ? post.items : [])].flatMap(i => [
        [i?.imageUrl, ['snapshots']], [i?.thumbnailUrl, ['snapshots', 'videos']], [i?.thumbSmallUrl, ['snapshots', 'videos']],
        [i?.posterUrl, ['videos']], [i?.videoUrl, ['videos']], [i?.audioUrl, ['audio', 'videos']]]);
      if (!urls.every(([u, kinds]) => ownMedia(u, user.uid, kinds))) {
        return res.status(400).json({ ok: false, message: 'This sighting has media from outside NatureGram, so it can only stay in your journal.' });
      }
    }
    if (makePublic && (post.moderation?.status === 'edited' || !post.moderation)) {
      // The picture changed after publishing: check it again before it rejoins the feed
      const settings = await getSettings();
      try {
        const { reasons } = await moderateImages(deps, user.uid, [post], settings);
        const unsafe = reasons.filter(r => SAFETY_REASONS.includes(r));
        if (unsafe.length) {
          // Not something the explorer can crop away: the admin decides
          const batch = db.batch();
          batch.update(ref, { isPublic: false, moderation: { status: 'pending', reasons, requestedFeed: true, imageChecked: true, at: FieldValue.serverTimestamp() } });
          batch.set(db.doc(`review_queue/${id}`), {
            kind: 'safety', postId: id, userId: user.uid, reasons, requestedFeed: true, published: false, requestedByExplorer: false, note: null,
            thumb: post.thumbSmallUrl || post.thumbnailUrl || post.imageUrl || null, createdAt: FieldValue.serverTimestamp(), status: 'open',
          });
          await batch.commit();
          return res.status(202).json({ ok: false, code: 'pending', message: 'Saved to your journal. It will appear in the feed once it has been reviewed.' });
        }
        if (reasons.length) {
          const first = PRIVACY_REASONS.find(r => reasons.includes(r));
          return res.status(422).json({ ok: false, code: first, message: settings.guidance[first], reasons });
        }
        recheck = { status: 'clear', at: FieldValue.serverTimestamp() };
      } catch {
        return res.status(503).json({ ok: false, message: 'Could not check the new picture just now. Please try again.' });
      }
    }
    if (makePublic && !recheck && post.moderation?.status !== 'clear') {
      return res.status(409).json({ ok: false, message: 'This sighting is waiting for review before it can join the feed.' });
    }
    if (makePublic && post.reportStatus === 'hidden') return res.status(409).json({ ok: false, message: 'This sighting was removed from the feed.' });
    const batch = db.batch();
    // A teen's sighting joins the feed without its place
    const hidePlace = makePublic && teen.teen ? { showLocation: false, locationArea: '' } : {};
    batch.update(ref, { ...(recheck ? { isPublic: true, moderation: recheck } : { isPublic: makePublic }), ...hidePlace });
    if (makePublic) batch.set(db.doc(`feed_thumbnails/${id}`), thumbnailOf(id, { ...post, ...hidePlace, isPublic: true }));
    else batch.delete(db.doc(`feed_thumbnails/${id}`));
    await batch.commit();
    if ((post.isPublic === true) !== makePublic) {
      recomputeUserStats(db, user.uid, FieldValue).catch(e => log('warn', 'stats recount failed', { uid: user.uid, error: String(e.message).slice(0, 120) }));
    }
    res.json({ ok: true, isPublic: makePublic });
  });
}

export function thumbnailOf(id, post) {
  return {
    id, mediaType: post.mediaType || 'image',
    thumbnailUrl: post.thumbnailUrl || post.imageUrl || '', thumbSmallUrl: post.thumbSmallUrl || null,
    videoUrl: post.videoUrl || null,
    title: post.title || null, caption: post.caption || null, description: post.description || null,
    timestamp: post.timestamp || FieldValue.serverTimestamp(),
    userId: post.userId, userName: post.userName || null, userAvatar: post.userAvatar || null,
    likes: post.likes || [], likeCount: post.likeCount || 0, commentCount: post.commentCount || 0,
    isPublic: true, tags: post.tags || [], labels: post.labels || [], behavior: post.behavior || '',
    aiInsight: post.aiInsight || null, aiConfidence: post.aiConfidence || null,
    locationArea: post.showLocation === false ? '' : (post.locationArea || ''),
    isHybrid: !!post.isHybrid,
    searchTokens: Array.isArray(post.searchTokens) ? post.searchTokens : [],
    // The tile paints at its size with a blurred preview before the picture arrives
    ...previewFields(post, post.mediaType),
    ...(typeof post.posterUrl === 'string' && post.posterUrl ? { posterUrl: post.posterUrl } : {}),
    ...(post.communityVerified === true ? { communityVerified: true, idAgreeCount: post.idAgreeCount || 2 } : {}),
  };
}
