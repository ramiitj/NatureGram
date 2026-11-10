/**
 * NatureGram Cloud Functions
 * - sendActivityPush: delivers a web/mobile push for every new in-app notification.
 * - transcodeMedia / backfillTranscodes: playable MP4s for WebM recordings.
 * - transcodeMedia / backfillPosters: posters, blur-up previews, sizes and the sound-only mark for clips.
 * Deploy: firebase deploy --only functions   (requires the Blaze plan)
 */
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { unlink, writeFile } from 'node:fs/promises';
import { parseProbe, cleanLqip, cleanDim, storagePathOf, mediaPathsOf, fillEmpty, planPostFill, needsPoster } from './mediaProbe.js';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { statsFromPosts, affectsStats, recomputeUserStats } from './userStats.js';

initializeApp();
const db = getFirestore();

const TITLES = { like: 'New like', comment: 'New comment', follow: 'New follower', mention: 'You were mentioned', reply: 'New reply' };

export const sendActivityPush = onDocumentCreated({ document: 'users/{uid}/notifications/{notifId}', region: 'asia-east1' }, async (event) => {
  const n = event.data?.data();
  if (!n) return;
  const { uid } = event.params;
  const pushDoc = await db.doc(`users/${uid}/private/push`).get();
  const tokens = (pushDoc.exists && pushDoc.data().tokens) || [];
  if (!tokens.length) return;

  const url = n.type === 'follow' && n.senderId ? `/profile?user=${n.senderId}` : (n.postId ? `/feed?p=${n.postId}` : '/feed');
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: TITLES[n.type] || 'NatureGram', body: String(n.message || '').slice(0, 180) },
    data: { url, tag: `ng-${n.type || 'activity'}` },
    webpush: { fcmOptions: { link: url } },
  });
  // Prune tokens that are no longer valid
  const stale = res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code || '') ? tokens[i] : null)).filter(Boolean);
  if (stale.length) await pushDoc.ref.update({ tokens: FieldValue.arrayRemove(...stale) });
});


// ---------------------------------------------------------------------------------------------
// Media transcoding: WebM (Chrome/Android recordings) → MP4/H.264 + AAC so every device, including
// iPhone Safari, can play it. Variants are recorded in media_variants/{path with / → |} and the
// client (components/PlayableVideo.tsx) swaps them in when the browser can't play WebM.
//
// Posters: every clip in videos/ (WebM or MP4) also gets a still (720 px and 400 px), a tiny blur-up
// preview (lqip), its main colour (tint) and its size. They are written back onto the posts that
// use the clip (found by `mediaPaths`, set at publish), their items and their feed entries, filling
// only empty fields. A file with no picture stream is marked `soundOnly: true`. Nothing is deleted.
// ---------------------------------------------------------------------------------------------
const MEDIA_RE = /^(videos|audio|drafts)\/[^/]+\/[^/]+\.webm$/;
const POSTER_RE = /^videos\/[^/]+\/[^/]+\.(mp4|m4v|mov|webm)$/i;
const variantRef = (name) => db.doc(`media_variants/${name.replace(/\//g, '|')}`);
// Clips are downloaded to /tmp, which counts against the function's memory: posters skip anything larger
const MAX_POSTER_BYTES = 600 * 1024 * 1024;

/** Runs ffmpeg; resolves { code, stderr, stdout } (stdout only when asked for). */
const ff = (args, { stdout = false } = {}) => new Promise((resolve, reject) => {
  const p = spawn(ffmpegPath, ['-hide_banner', ...args], { stdio: ['ignore', stdout ? 'pipe' : 'ignore', 'pipe'] });
  let err = '';
  const out = [];
  p.stderr.on('data', d => { err = (err + d.toString()).slice(-16000); });
  if (stdout) p.stdout.on('data', d => out.push(d));
  p.on('error', reject);
  p.on('close', code => resolve({ code, stderr: err, stdout: Buffer.concat(out) }));
});
const run = async (args) => {
  const r = await ff(['-y', ...args]);
  if (r.code !== 0) throw new Error(`ffmpeg exited ${r.code}: ${r.stderr.slice(-2000)}`);
};
/** What a file holds (`ffmpeg -i` with no output always exits 1; the stream list is on stderr). */
const probe = async (local) => parseProbe((await ff(['-i', local])).stderr);

/** ~16 px wide WebP (JPEG if WebP is unavailable) as a data URL, plus the average colour. */
async function previewOf(local) {
  let lqip = null;
  for (const enc of [['-c:v', 'libwebp', '-q:v', '30', '-f', 'webp'], ['-q:v', '12', '-f', 'mjpeg']]) {
    const r = await ff(['-i', local, '-frames:v', '1', '-vf', 'scale=16:-2', ...enc, 'pipe:1'], { stdout: true }).catch(() => null);
    if (!r || r.code !== 0 || !r.stdout.length) continue;
    const url = `data:image/${enc.includes('webp') ? 'webp' : 'jpeg'};base64,${r.stdout.toString('base64')}`;
    if (cleanLqip(url)) { lqip = url; break; }
  }
  let tint = null;
  const t = await ff(['-i', local, '-frames:v', '1', '-vf', 'scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdout: true }).catch(() => null);
  if (t && t.code === 0 && t.stdout.length >= 3) tint = '#' + [...t.stdout.subarray(0, 3)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { lqip, tint };
}

const uploader = (bucket) => async (local, dest, type) => {
  const token = randomUUID();
  // ngDerived: our own outputs must not trigger this function again
  await bucket.upload(local, { destination: dest, metadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token, ngDerived: '1' } } });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`;
};

/** Stills, preview and size for a downloaded clip. Returns the media record (soundOnly when it has no picture). */
async function postersFor(bucket, name, src, info, id) {
  if (!info.hasVideo) return { soundOnly: true };
  const big = join(tmpdir(), `${id}.poster.jpg`);
  const small = join(tmpdir(), `${id}.poster.small.jpg`);
  try {
    const seek = info.duration && info.duration < 1.2 ? '0' : '0.5';
    await run(['-ss', seek, '-i', src, '-frames:v', '1', '-vf', 'scale=min(720\\,iw):-2', '-q:v', '3', big])
      .catch(() => run(['-i', src, '-frames:v', '1', '-vf', 'scale=min(720\\,iw):-2', '-q:v', '3', big]));
    await run(['-i', big, '-vf', 'scale=min(400\\,iw):-2', '-q:v', '4', small]).catch(() => {});
    const dir = name.slice(0, name.lastIndexOf('/'));
    const stem = basename(name).replace(/\.[^.]+$/, '');
    const upload = uploader(bucket);
    const posterUrl = await upload(big, `${dir}/${stem}.poster.jpg`, 'image/jpeg');
    const posterSmallUrl = await upload(small, `${dir}/${stem}.poster.small.jpg`, 'image/jpeg').catch(() => null);
    const shown = await probe(big);
    const { lqip, tint } = await previewOf(small).catch(() => ({}));
    return {
      posterUrl, posterSmallUrl,
      w: cleanDim(info.w) || cleanDim(shown.w), h: cleanDim(info.h) || cleanDim(shown.h),
      lqip: lqip || null, tint: tint || null, soundOnly: false,
    };
  } finally {
    await Promise.all([big, small].map(f => unlink(f).catch(() => {})));
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Adds the clip's poster to one post, its items and its feed entry (empty fields only), atomically. */
async function applyToPost(ref, path, media) {
  return db.runTransaction(async (tx) => {
    const thumbRef = db.doc(`feed_thumbnails/${ref.id}`);
    const [snap, thumb] = await Promise.all([tx.get(ref), tx.get(thumbRef)]);
    if (!snap.exists) return false;
    const plan = planPostFill(snap.data(), path, media);
    if (!plan) return false;
    tx.update(ref, plan.post);
    if (plan.top && thumb.exists) {
      const add = fillEmpty(thumb.data(), media);
      if (Object.keys(add).length) tx.update(thumbRef, add);
    }
    return true;
  });
}

/**
 * Finds the posts that use a clip and fills them in. A clip is often finished before its post is
 * written (the explorer is still captioning), so look again a few times before giving up; the
 * backfill catches anything missed. Only the uploader's own posts are touched.
 */
async function writeBack(path, media, { retries = 3 } = {}) {
  const uid = path.split('/')[1];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const snap = await db.collection('ecosystem_feed').where('mediaPaths', 'array-contains', path).limit(10).get();
    const docs = snap.docs.filter(d => d.get('userId') === uid);
    if (docs.length) {
      let n = 0;
      for (const d of docs) if (await applyToPost(d.ref, path, media).catch(e => { console.error('poster write-back failed', d.id, e.message); return false; })) n++;
      return n;
    }
    if (attempt < retries) await sleep(20_000 * (attempt + 1));
  }
  return 0;
}

const variantMedia = (v) => (v ? {
  posterUrl: v.posterUrl || null, posterSmallUrl: v.posterSmallUrl || null, w: v.w || null, h: v.h || null,
  lqip: v.lqip || null, tint: v.tint || null, soundOnly: v.soundOnly === true,
} : null);
const mediaComplete = (m) => !!m && (m.soundOnly === true || !!(m.posterUrl && m.lqip && m.w && m.h));

async function transcodeObject(bucketName, name, contentType, { transcode = true } = {}) {
  const bucket = getStorage().bucket(bucketName);
  const isVideo = (String(contentType || '').startsWith('video/') || /\.(mp4|m4v|mov)$/i.test(name)) && !name.startsWith('audio/');
  const id = randomUUID();
  const ext = (/\.[^.]+$/.exec(name)?.[0] || '.webm').toLowerCase();
  const src = join(tmpdir(), `${id}${ext}`);
  const out = join(tmpdir(), `${id}.${isVideo ? 'mp4' : 'm4a'}`);
  try {
    await bucket.file(name).download({ destination: src });
    const info = isVideo ? await probe(src) : null;
    const variant = { source: name, updatedAt: FieldValue.serverTimestamp() };
    const dir = name.slice(0, name.lastIndexOf('/'));
    const stem = basename(name).replace(/\.[^.]+$/, '');
    if (transcode) {
      if (isVideo && info?.hasVideo === false) await run(['-i', src, '-vn', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
      else if (isVideo) await run(['-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(min(1280\\,iw)/2)*2:-2', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', out]);
      else await run(['-i', src, '-vn', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
      variant.mp4Url = await uploader(bucket)(out, `${dir}/${stem}.${isVideo ? 'mp4' : 'm4a'}`, isVideo ? 'video/mp4' : 'audio/mp4');
    }
    let media = null;
    if (isVideo && name.startsWith('videos/')) {
      media = await postersFor(bucket, name, src, info, id).catch(e => { console.error('poster failed', name, e.message); return null; });
      if (media) Object.assign(variant, Object.fromEntries(Object.entries(media).filter(([, v]) => v !== null && v !== undefined)));
    }
    await variantRef(name).set(variant, { merge: true });
    return { variant, media };
  } finally {
    await Promise.all([src, out].map(f => unlink(f).catch(() => {})));
  }
}

export const transcodeMedia = onObjectFinalized({ region: 'asia-east1', memory: '2GiB', cpu: 2, timeoutSeconds: 540 }, async (event) => {
  const { name, bucket, contentType, metadata, size } = event.data;
  if (!name || metadata?.ngDerived) return;
  const webm = MEDIA_RE.test(name);
  if (!webm && !POSTER_RE.test(name)) return;
  if (!webm && Number(size) > MAX_POSTER_BYTES) return;
  const { media } = await transcodeObject(bucket, name, contentType, { transcode: webm });
  if (media && name.startsWith('videos/')) await writeBack(name, media);
});

/** Admin-only: transcode existing WebM media (run once after deploying). */
export const backfillTranscodes = onCall({ region: 'asia-east1', memory: '2GiB', cpu: 2, timeoutSeconds: 540 }, async (req) => {
  const isAdmin = req.auth?.token?.admin === true && req.auth?.token?.email_verified === true;
  if (!isAdmin) throw new HttpsError('permission-denied', 'Admins only');
  const bucket = getStorage().bucket();
  let done = 0;
  for (const prefix of ['videos/', 'audio/']) {
    const [files] = await bucket.getFiles({ prefix });
    for (const f of files) {
      if (!MEDIA_RE.test(f.name)) continue;
      const existing = await variantRef(f.name).get();
      // A variant may hold only a poster (from the poster backfill): it still needs its MP4
      if (existing.exists && existing.get('mp4Url')) continue;
      await transcodeObject(bucket.name, f.name, f.metadata.contentType).catch(e => console.error('transcode failed', f.name, e.message));
      done++;
      if (done >= 50) return { done, more: true };
    }
  }
  return { done, more: false };
});

/** Poster, preview and size for one clip: from its media_variants record when complete, else made now. */
async function mediaForClip(bucket, path) {
  const v = await variantRef(path).get();
  const known = variantMedia(v.exists ? v.data() : null);
  if (mediaComplete(known)) return known;
  // An older variant with a still but no preview: read the still rather than the whole clip
  if (known?.posterUrl && !known.soundOnly) {
    const fromStill = await mediaForImage(bucket, known.posterUrl).catch(() => null);
    if (fromStill) {
      const media = { ...known, w: known.w || fromStill.w, h: known.h || fromStill.h, lqip: known.lqip || fromStill.lqip, tint: known.tint || fromStill.tint, soundOnly: false };
      await variantRef(path).set(Object.fromEntries(Object.entries(media).filter(([, x]) => x !== null && x !== undefined)), { merge: true });
      return media;
    }
  }
  const [exists] = await bucket.file(path).exists();
  if (!exists) return null;
  const meta = (await bucket.file(path).getMetadata().catch(() => [{}]))[0] || {};
  if (Number(meta.size) > MAX_POSTER_BYTES) return null;
  const contentType = meta.contentType || 'video/webm';
  const { media } = await transcodeObject(bucket.name, path, contentType, { transcode: false });
  return media;
}

/** Preview and size for a still (a photo's thumbnail): downloaded from storage, or over HTTPS for older links. */
async function mediaForImage(bucket, url) {
  const id = randomUUID();
  const local = join(tmpdir(), `${id}.img`);
  try {
    const path = storagePathOf(url);
    if (path && /^(snapshots|videos)\/[^/]+\/[^/]+$/.test(path)) {
      await bucket.file(path).download({ destination: local });
    } else {
      if (!/^https:\/\//.test(String(url))) return null;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 15 * 1024 * 1024) return null;
      await writeFile(local, buf);
    }
    const info = await probe(local);
    if (!info.hasVideo) return null; // not a picture ffmpeg can read
    const { lqip, tint } = await previewOf(local);
    return { w: cleanDim(info.w), h: cleanDim(info.h), lqip, tint, soundOnly: false };
  } finally {
    await unlink(local).catch(() => {});
  }
}

/** Fills a photo post's preview and size (post, first item when it is the same picture, feed entry). */
async function applyImage(ref, url, media) {
  return db.runTransaction(async (tx) => {
    const thumbRef = db.doc(`feed_thumbnails/${ref.id}`);
    const [snap, thumb] = await Promise.all([tx.get(ref), tx.get(thumbRef)]);
    if (!snap.exists) return false;
    const p = snap.data();
    const top = fillEmpty(p, media, { thumbs: false });
    const update = { ...top };
    if (Array.isArray(p.items) && p.items[0] && [p.items[0].thumbSmallUrl, p.items[0].thumbnailUrl, p.items[0].imageUrl].includes(url)) {
      const add = fillEmpty(p.items[0], media, { thumbs: false });
      if (Object.keys(add).length) update.items = [{ ...p.items[0], ...add }, ...p.items.slice(1)];
    }
    if (!Array.isArray(p.mediaPaths)) { const paths = mediaPathsOf(p); if (paths.length) update.mediaPaths = paths; }
    if (!Object.keys(update).length) return false;
    tx.update(ref, update);
    if (thumb.exists && Object.keys(top).length) {
      const add = fillEmpty(thumb.data(), media, { thumbs: false });
      if (Object.keys(add).length) tx.update(thumbRef, add);
    }
    return true;
  });
}

/**
 * Admin-only: "Give every video a poster". Walks posts in id order from `after`, a few at a time
 * (each clip may need downloading), and fills posters, previews, sizes and the sound-only mark.
 * Idempotent: complete posts are skipped and filled fields are never overwritten. Returns `next`
 * (null when finished) so the console can call again and resume after an interruption.
 */
export const backfillPosters = onCall({ region: 'asia-east1', memory: '2GiB', cpu: 2, timeoutSeconds: 540 }, async (req) => {
  const isAdmin = req.auth?.token?.admin === true && req.auth?.token?.email_verified === true;
  if (!isAdmin) throw new HttpsError('permission-denied', 'Admins only');
  const size = Math.min(25, Math.max(1, Number(req.data?.limit) || 8));
  const after = typeof req.data?.after === 'string' ? req.data.after : '';
  if (after && !/^[A-Za-z0-9_-]{1,128}$/.test(after)) throw new HttpsError('invalid-argument', 'Bad cursor');
  let q = db.collection('ecosystem_feed').orderBy(FieldPath.documentId()).limit(size);
  if (after) q = q.startAfter(after);
  const snap = await q.get();
  const bucket = getStorage().bucket();
  const started = Date.now();
  const tally = { processed: 0, updated: 0, posters: 0, soundOnly: 0, failed: 0 };
  let last = after || null;
  for (const doc of snap.docs) {
    // Leave time to answer: the rest is picked up on the next call
    if (Date.now() - started > 420_000) break;
    last = doc.id;
    tally.processed++;
    const p = doc.data();
    if (!needsPoster(p)) continue;
    try {
      let changed = false;
      const clips = [p, ...(Array.isArray(p.items) ? p.items : [])]
        .map(i => storagePathOf(i?.videoUrl)).filter(path => path && /^videos\/[^/]+\/[^/]+$/.test(path) && path.split('/')[1] === p.userId);
      for (const path of [...new Set(clips)].slice(0, 4)) {
        const media = await mediaForClip(bucket, path);
        if (!media) continue;
        if (media.soundOnly) tally.soundOnly++; else if (media.posterUrl) tally.posters++;
        if (await applyToPost(doc.ref, path, media)) changed = true;
      }
      const fresh = changed ? (await doc.ref.get()).data() : p;
      const still = fresh.thumbSmallUrl || fresh.thumbnailUrl || fresh.imageUrl;
      if (still && fresh.soundOnly !== true && (!fresh.lqip || !fresh.w || !fresh.h)) {
        const media = await mediaForImage(bucket, still).catch(() => null);
        if (media && await applyImage(doc.ref, still, media)) changed = true;
      }
      if (!Array.isArray(fresh.mediaPaths)) {
        const paths = mediaPathsOf(fresh);
        if (paths.length) { await doc.ref.update({ mediaPaths: paths }); changed = true; }
      }
      if (changed) tally.updated++;
    } catch (e) {
      tally.failed++;
      console.error('poster backfill failed', doc.id, e.message);
    }
  }
  const finished = tally.processed === snap.size && snap.size < size;
  return { ...tally, next: finished ? null : last };
});


// ---------------------------------------------------------------------------------------------
// Field-note (comment) moderation: the same cheap word and spam checks the server runs on captions
// (server/moderationText.js; keep the two in step). A flagged note is hidden (hidden: true) and
// queued for the admin; nothing is deleted. The app hides `hidden` notes from everyone but their author.
// ---------------------------------------------------------------------------------------------
const BASE_WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'cunt', 'bitch', 'bastard', 'asshole', 'dickhead',
  'whore', 'slut', 'retard', 'retarded', 'faggot', 'fag', 'nigger', 'nigga', 'chink', 'spic', 'kike', 'paki', 'tranny',
  'rape', 'rapist', 'porn', 'porno', 'nude', 'nudes', 'xxx', 'onlyfans',
  'kill yourself', 'kys', 'go die',
];
const PROMO = /\b(whatsapp|telegram|dm me|follow me|follow back|promo|discount|coupon|giveaway|buy now|free followers|subscribe|casino|betting|jackpot|lottery|crypto|forex|loan offer|earn money|work from home)\b/i;
const LINKS = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|xyz|io|in|co|me|link|site|shop)\b/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let wordsCache = { at: 0, extra: [] };
async function extraWords() {
  if (Date.now() - wordsCache.at < 5 * 60_000) return wordsCache.extra;
  try {
    const s = await db.doc('admin_private/settings').get();
    wordsCache = { at: Date.now(), extra: (s.exists && Array.isArray(s.get('moderationWords'))) ? s.get('moderationWords') : [] };
  } catch { wordsCache.at = Date.now(); }
  return wordsCache.extra;
}
export function commentFlags(text, extra = []) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const words = [...BASE_WORDS, ...extra.map(w => String(w).trim().toLowerCase()).filter(w => w.length >= 2 && w.length <= 40)];
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(escapeRe).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');
  const reasons = new Set();
  if (re.test(t)) reasons.add('words');
  if (PROMO.test(t) || LINKS.test(t) || /(.)\1{9,}/u.test(t)) reasons.add('spam');
  const letters = t.replace(/[^\p{L}]/gu, ''); const upper = t.replace(/[^\p{Lu}]/gu, '');
  if (letters.length >= 40 && upper.length / letters.length > 0.8) reasons.add('spam');
  if ((t.match(/@[A-Za-z0-9_.]{3,30}/g) || []).length > 8) reasons.add('spam');
  return [...reasons];
}

export const moderateComment = onDocumentCreated({ document: 'ecosystem_feed/{postId}/comments/{commentId}', region: 'asia-east1' }, async (event) => {
  const c = event.data?.data();
  if (!c) return;
  const reasons = commentFlags(c.text, await extraWords());
  if (!reasons.length) return;
  const { postId, commentId } = event.params;
  const batch = db.batch();
  batch.update(event.data.ref, { hidden: true, moderation: { status: 'pending', reasons, at: FieldValue.serverTimestamp() } });
  batch.set(db.doc(`review_queue/c_${postId}_${commentId}`), {
    kind: 'comment', postId, commentId, userId: c.userId || null, reasons,
    text: String(c.text || '').slice(0, 300), requestedFeed: false, createdAt: FieldValue.serverTimestamp(), status: 'open',
  });
  await batch.commit();
});

// ---------------------------------------------------------------------------------------------
// Community verification on the post itself (additive fields), so lists and exports can use it
// without reading every identification: idAgreeCount = explorers whose ID matches the posted name,
// communityVerified = 2 or more (the same rule as components/CommunityId.tsx).
// ---------------------------------------------------------------------------------------------
const normName = (s) => String(s || '').trim().toLowerCase();
export const syncCommunityVerification = onDocumentWritten({ document: 'ecosystem_feed/{postId}/identifications/{uid}', region: 'asia-east1' }, async (event) => {
  const { postId } = event.params;
  const postRef = db.doc(`ecosystem_feed/${postId}`);
  const post = await postRef.get();
  if (!post.exists) return;
  const primary = normName(post.get('labels')?.[0]);
  const ids = await postRef.collection('identifications').limit(200).get();
  const agree = ids.docs.filter(d => normName(d.get('name')) === primary).length;
  const verified = agree >= 2;
  if (post.get('idAgreeCount') === agree && post.get('communityVerified') === verified) return;
  const patch = { idAgreeCount: agree, communityVerified: verified, ...(verified && !post.get('communityVerifiedAt') ? { communityVerifiedAt: FieldValue.serverTimestamp() } : {}) };
  await postRef.update(patch);
  const thumb = db.doc(`feed_thumbnails/${postId}`);
  if ((await thumb.get()).exists) await thumb.update(patch);
});

// ---------------------------------------------------------------------------------------------
// Nightly counter reconciliation. Recomputes, from the source documents:
//   posts: likeCount (like documents not already counted in the legacy likes array, so that
//          likeTotal = likeCount + likes.length counts each explorer once) and commentCount;
//   users: followersCount and followingCount, and stats.species / stats.sightings (stats.reconciledAt).
// Works in pages with a cursor saved in admin_private/reconcile, so a large database is covered
// over several nights. Writes only when a number is different. Never deletes anything.
// ---------------------------------------------------------------------------------------------
const RECONCILE_PAGE = 200;
const countOf = async (q) => (await q.count().get()).data().count;

export async function reconcilePost(doc) {
  const p = doc.data();
  const legacy = new Set(Array.isArray(p.likes) ? p.likes : []);
  const likeDocs = await doc.ref.collection('likes').select().get();
  const likeCount = likeDocs.docs.filter(d => !legacy.has(d.id)).length;
  const commentCount = await countOf(doc.ref.collection('comments'));
  const patch = {};
  if ((p.likeCount || 0) !== likeCount) patch.likeCount = likeCount;
  if ((p.commentCount || 0) !== commentCount) patch.commentCount = commentCount;
  return patch;
}

export async function reconcileUser(doc) {
  const u = doc.data();
  const [followers, following, posts] = await Promise.all([
    countOf(doc.ref.collection('followers')), countOf(doc.ref.collection('following')),
    db.collection('ecosystem_feed').where('userId', '==', doc.id).select('isPublic', 'labels').get(),
  ]);
  const patch = {};
  if ((u.followersCount || 0) !== followers) patch.followersCount = followers;
  if ((u.followingCount || 0) !== following) patch.followingCount = following;
  // One true count (server/userStats.js): species and sightings from public sightings, life-list names
  const st = statsFromPosts(posts.docs.map(d => d.data()));
  const have = u.stats || {};
  if (have.species !== st.species || have.sightings !== st.sightings || !have.reconciledAt) {
    patch['stats.species'] = st.species;
    patch['stats.sightings'] = st.sightings;
    patch['stats.reconciledAt'] = FieldValue.serverTimestamp();
  }
  return patch;
}

// ---------------------------------------------------------------------------------------------
// Keep users/{uid}.stats in step whenever a sighting is created, deleted, shared, hidden or renamed,
// wherever that happened (the app deletes posts directly; the admin and guardian paths hide them).
// Likes, notes and other edits don't move the counts, so they are skipped.
// ---------------------------------------------------------------------------------------------
export const syncUserStats = onDocumentWritten({ document: 'ecosystem_feed/{postId}', region: 'asia-east1' }, async (event) => {
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  if (!before && !after) return;
  if (!affectsStats(before, after)) return;
  const uids = new Set([before?.userId, after?.userId].filter(Boolean));
  for (const uid of uids) await recomputeUserStats(db, uid, FieldValue).catch(e => console.warn('stats recount failed', uid, e.message));
});

async function reconcilePage(collectionName, after, fix, onFixed) {
  let q = db.collection(collectionName).orderBy(FieldPath.documentId()).limit(RECONCILE_PAGE);
  if (after) q = q.startAfter(after);
  const snap = await q.get();
  let fixed = 0;
  for (const d of snap.docs) {
    const patch = await fix(d).catch((e) => { console.warn('reconcile skipped', collectionName, d.id, e.message); return {}; });
    if (Object.keys(patch).length) { await d.ref.update(patch); fixed++; await onFixed?.(d, patch); }
  }
  return { next: snap.size === RECONCILE_PAGE ? snap.docs[snap.size - 1].id : null, scanned: snap.size, fixed };
}

export const reconcileCounters = onSchedule({ schedule: '17 3 * * *', timeZone: 'UTC', region: 'asia-east1', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const started = Date.now();
  const stateRef = db.doc('admin_private/reconcile');
  const state = (await stateRef.get()).data() || {};
  let postCursor = state.postCursor || null;
  let userCursor = state.userCursor || null;
  let postsDone = false;
  let usersDone = false;
  const totals = { posts: 0, users: 0, postsFixed: 0, usersFixed: 0 };
  const mirror = async (d, patch) => {
    const t = db.doc(`feed_thumbnails/${d.id}`);
    if ((await t.get()).exists) await t.update(patch);
  };
  // Alternate posts and users; stop well before the time limit and carry on tomorrow
  while (Date.now() - started < 420_000 && !(postsDone && usersDone)) {
    if (!postsDone) {
      const p = await reconcilePage('ecosystem_feed', postCursor, reconcilePost, mirror);
      postCursor = p.next; totals.posts += p.scanned; totals.postsFixed += p.fixed;
      if (!p.next) postsDone = true;
    }
    if (!usersDone) {
      const u = await reconcilePage('users', userCursor, reconcileUser);
      userCursor = u.next; totals.users += u.scanned; totals.usersFixed += u.fixed;
      if (!u.next) usersDone = true;
    }
    // A finished pass saves a null cursor, so the next run starts again from the top
    await stateRef.set({ postCursor, userCursor, lastRunAt: FieldValue.serverTimestamp(), lastTotals: totals }, { merge: true });
  }
  console.log('reconcileCounters', JSON.stringify(totals));
});

// ---------------------------------------------------------------------------------------------
// Teen mode: on the first day of the month a teenage explorer turns 18 (users.adultFrom) they
// become an adult: ageBand 'adult', adultFrom and guardian removed, and they leave their parent's
// guardianOf list. The server also does this lazily whenever it reads a band (server/guardian.js);
// this nightly pass catches explorers who haven't been back. adultFrom exists only on teen
// profiles, so a single range query (no composite index) finds them.
// ---------------------------------------------------------------------------------------------
export const graduateTeens = onSchedule({ schedule: '41 2 * * *', timeZone: 'UTC', region: 'asia-east1', timeoutSeconds: 300, memory: '256MiB' }, async () => {
  const now = new Date();
  const snap = await db.collection('users').where('adultFrom', '<=', now).limit(400).get();
  let graduated = 0;
  for (const d of snap.docs) {
    const u = d.data();
    if (u.ageBand !== 'teen') continue;
    const parentUid = u.guardian?.parentUid || null;
    const batch = db.batch();
    batch.set(d.ref, { ageBand: 'adult', adultFrom: FieldValue.delete(), guardian: FieldValue.delete(), graduatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (parentUid) batch.set(db.doc(`users/${parentUid}`), { guardianOf: FieldValue.arrayRemove(d.id) }, { merge: true });
    batch.set(db.doc(`guardian_consents/${d.id}`), { status: 'graduated', graduatedAt: FieldValue.serverTimestamp(), history: FieldValue.arrayUnion({ event: 'graduated', at: now }) }, { merge: true });
    await batch.commit().then(() => { graduated++; }).catch((e) => console.warn('graduate skipped', d.id, e.message));
  }
  console.log('graduateTeens', JSON.stringify({ scanned: snap.size, graduated }));
});
