/**
 * NatureGram Cloud Functions
 * - sendActivityPush: delivers a web/mobile push for every new in-app notification.
 * Deploy: firebase deploy --only functions   (requires the Blaze plan)
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
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
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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
