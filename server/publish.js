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
import { FieldValue } from 'firebase-admin/firestore';
import { getFlags, getSettings } from './settings.js';
import { charge, usageFor, logAi, addGlobalTokens } from './ledger.js';
import { moderationBody, policyText, findPolicyBreach } from './aiGovernance.js';

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

/** Media may only come from the explorer's own folders. */
export function ownMedia(url, uid, kinds) {
  if (url == null || url === '') return true;
  const p = storagePathOf(url);
  if (!p || p.includes('..')) return false;
  return kinds.some(k => p.startsWith(`${k}/${uid}/`));
}

export const textBreach = (...texts) => texts.some(t => t && SPAM.test(String(t)));

function cleanItem(it, uid) {
  const i = it && typeof it === 'object' ? it : {};
  const images = ['imageUrl', 'thumbnailUrl', 'thumbSmallUrl', 'originalImageUrl'];
  for (const k of images) if (!ownMedia(i[k], uid, ['snapshots'])) throw Object.assign(new Error('media'), { code: 'media' });
  if (!ownMedia(i.videoUrl, uid, ['videos'])) throw Object.assign(new Error('media'), { code: 'media' });
  if (!ownMedia(i.audioUrl, uid, ['audio', 'videos'])) throw Object.assign(new Error('media'), { code: 'media' });
  const assoc = Array.isArray(i.associatedImageUrls) ? i.associatedImageUrls.slice(0, 8) : [];
  if (!assoc.every(u => ownMedia(u, uid, ['snapshots']))) throw Object.assign(new Error('media'), { code: 'media' });
  const mediaType = ['image', 'video', 'audio'].includes(i.mediaType) ? i.mediaType : 'image';
  return {
    imageUrl: i.imageUrl || null, thumbnailUrl: i.thumbnailUrl || null, thumbSmallUrl: i.thumbSmallUrl || null,
    originalImageUrl: i.originalImageUrl || null, videoUrl: i.videoUrl || null, audioUrl: i.audioUrl || null,
    associatedImageUrls: assoc, mediaType,
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
    const { out, tokens } = await callModel(deps, settings.models.moderate, moderationBody(settings, img.data, img.mimeType));
    addGlobalTokens(tokens);
    if (!out) throw new Error('empty moderation answer');
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

  app.post('/api/publish', express.json({ limit: '256kb' }), async (req, res) => {
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
    if (sensitive) items.forEach(i => { i.locationArea = ''; i.showLocation = false; });

    // Image check
    let reasons = [];
    let unchecked = false;
    if (items.some(i => i.aiFlags?.isNatureSubject === false)) reasons.push('notNature');
    if (items.some(i => i.aiFlags?.peopleVisible)) reasons.push('people');
    try {
      const m = await moderateImages(deps, user.uid, items, settings);
      reasons = Array.from(new Set([...reasons, ...m.reasons]));
    } catch (e) {
      unchecked = true;
      log('warn', 'publish check unavailable', { uid: user.uid, error: String(e.message).slice(0, 120) });
    }

    const wantsFeed = body.feed === true;
    const requestReview = body.requestReview === true;
    if (reasons.length && !requestReview) {
      const order = ['faces', 'people', 'plates', 'screen', 'notNature'];
      const first = order.find(r => reasons.includes(r));
      return say(422, first, g[first], { reasons, fix: first === 'notNature' || first === 'screen' ? 'retake' : 'crop', canRequestReview: true });
    }

    // Charge the allowance (atomic, same limit for everyone)
    const charged = await charge(user.uid, 'posts', 1, limit);
    if (charged.unavailable) return say(503, 'unavailable', 'Publishing is unavailable for a moment. Please try again.');
    if (!charged.ok) return say(429, 'allowance', `You've shared today's ${limit} sightings. Sharing opens again at midnight UTC.`);

    const held = reasons.length > 0 || unchecked;
    const profile = (await db.doc(`users/${user.uid}`).get().catch(() => null))?.data() || {};
    const primary = items[0];
    const labels = Array.from(new Set(items.flatMap(i => i.labels))).slice(0, 20);
    const post = {
      userId: user.uid,
      userName: str(profile.username, 40) || `Explorer-${user.uid.slice(0, 4)}`,
      userAvatar: profile.avatarUrl || null,
      imageUrl: primary.imageUrl, thumbnailUrl: primary.thumbnailUrl, thumbSmallUrl: primary.thumbSmallUrl,
      originalImageUrl: primary.originalImageUrl, videoUrl: primary.videoUrl, audioUrl: primary.audioUrl,
      associatedImageUrls: primary.associatedImageUrls, mediaType: primary.mediaType,
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
      isJournal: body.journal !== false || held,
      reportStatus: 'safe', reports: [],
      isHybrid: items.length > 1 || items.some(i => i.associatedImageUrls.length > 0),
      items: items.map(({ aiResultId, ...rest }) => ({ ...rest, aiResultId })),
      rotation: primary.rotation, timeToRecordMs: primary.timeToRecordMs, sessionRetakes: primary.sessionRetakes,
      humanDelta: items.some(i => i.humanDelta),
      moderation: held
        ? { status: 'held', reasons: unchecked && !reasons.length ? ['unchecked'] : reasons, requestedFeed: wantsFeed, at: FieldValue.serverTimestamp() }
        : { status: 'clear', at: FieldValue.serverTimestamp() },
    };
    if (title) post.title = title;
    if (description) post.description = description;

    const ref = db.collection('ecosystem_feed').doc();
    const batch = db.batch();
    batch.set(ref, post);
    if (post.isPublic) batch.set(db.doc(`feed_thumbnails/${ref.id}`), thumbnailOf(ref.id, post));
    if (held) {
      batch.set(db.doc(`review_queue/${ref.id}`), {
        postId: ref.id, userId: user.uid, reasons: post.moderation.reasons, requestedFeed: wantsFeed,
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

    log('info', 'published', { uid: user.uid, postId: ref.id, held, reasons: post.moderation.reasons || [] });
    res.json({
      ok: true, id: ref.id, held, isPublic: post.isPublic,
      url: primary.imageUrl || undefined, videoUrl: primary.videoUrl || undefined, audioUrl: primary.audioUrl || undefined,
      message: held ? 'Saved to your journal. It will appear in the feed once it has been reviewed.' : undefined,
      note: sensitive ? g.sensitive : undefined,
      left: Math.max(0, limit - charged.used),
    });
  });

  // Share a journal-only sighting to the feed later (only one that passed the checks)
  app.post('/api/posts/:id/visibility', express.json({ limit: '4kb' }), async (req, res) => {
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
    if (makePublic && (post.moderation?.status === 'edited' || !post.moderation)) {
      // The picture changed after publishing: check it again before it rejoins the feed
      const settings = await getSettings();
      try {
        const { reasons } = await moderateImages(deps, user.uid, [post], settings);
        if (reasons.length) {
          const first = ['faces', 'people', 'plates', 'screen', 'notNature'].find(r => reasons.includes(r));
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
    batch.update(ref, recheck ? { isPublic: true, moderation: recheck } : { isPublic: makePublic });
    if (makePublic) batch.set(db.doc(`feed_thumbnails/${id}`), thumbnailOf(id, { ...post, isPublic: true }));
    else batch.delete(db.doc(`feed_thumbnails/${id}`));
    await batch.commit();
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
  };
}
