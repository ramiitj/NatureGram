/**
 * NatureGram Cloud Functions
 * - sendActivityPush: delivers a web/mobile push for every new in-app notification.
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
import { unlink } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

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
// ---------------------------------------------------------------------------------------------
const MEDIA_RE = /^(videos|audio|drafts)\/[^/]+\/[^/]+\.webm$/;

const run = (args) => new Promise((resolve, reject) => {
  const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', d => { err += d.toString().slice(-2000); });
  p.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err}`)));
});

async function transcodeObject(bucketName, name, contentType) {
  const bucket = getStorage().bucket(bucketName);
  const isVideo = String(contentType || '').startsWith('video/') && !name.startsWith('audio/');
  const id = randomUUID();
  const src = join(tmpdir(), `${id}.webm`);
  const out = join(tmpdir(), `${id}.${isVideo ? 'mp4' : 'm4a'}`);
  const poster = join(tmpdir(), `${id}.jpg`);
  try {
    await bucket.file(name).download({ destination: src });
    if (isVideo) {
      await run(['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(min(1280\\,iw)/2)*2:-2', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', out]);
      await run(['-y', '-ss', '0.5', '-i', src, '-frames:v', '1', '-vf', 'scale=720:-2', poster]).catch(() => {});
    } else {
      await run(['-y', '-i', src, '-vn', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
    }
    const dir = name.slice(0, name.lastIndexOf('/'));
    const stem = basename(name, '.webm');
    const upload = async (local, dest, type) => {
      const token = randomUUID();
      await bucket.upload(local, { destination: dest, metadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } } });
      return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`;
    };
    const variant = { source: name, updatedAt: FieldValue.serverTimestamp() };
    if (isVideo) {
      variant.mp4Url = await upload(out, `${dir}/${stem}.mp4`, 'video/mp4');
      variant.posterUrl = await upload(poster, `${dir}/${stem}.poster.jpg`, 'image/jpeg').catch(() => null);
    } else {
      variant.mp4Url = await upload(out, `${dir}/${stem}.m4a`, 'audio/mp4');
    }
    await db.doc(`media_variants/${name.replace(/\//g, '|')}`).set(variant, { merge: true });
    return variant;
  } finally {
    await Promise.all([src, out, poster].map(f => unlink(f).catch(() => {})));
  }
}

export const transcodeMedia = onObjectFinalized({ region: 'asia-east1', memory: '2GiB', cpu: 2, timeoutSeconds: 540 }, async (event) => {
  const { name, bucket, contentType } = event.data;
  if (!name || !MEDIA_RE.test(name)) return;
  await transcodeObject(bucket, name, contentType);
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
      const existing = await db.doc(`media_variants/${f.name.replace(/\//g, '|')}`).get();
      if (existing.exists) continue;
      await transcodeObject(bucket.name, f.name, f.metadata.contentType).catch(e => console.error('transcode failed', f.name, e.message));
      done++;
      if (done >= 50) return { done, more: true };
    }
  }
  return { done, more: false };
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
//   users: followersCount and followingCount.
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
  const [followers, following] = await Promise.all([countOf(doc.ref.collection('followers')), countOf(doc.ref.collection('following'))]);
  const patch = {};
  if ((u.followersCount || 0) !== followers) patch.followersCount = followers;
  if ((u.followingCount || 0) !== following) patch.followingCount = following;
  return patch;
}

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
