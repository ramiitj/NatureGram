/**
 * Account deletion, done by the server with the Admin SDK so nothing is left behind on a phone that
 * lost its connection halfway.
 *
 *   DELETE /api/me   Authorization: Bearer <ID token>
 *
 * The sign-in must be recent (auth_time within RECENT_LOGIN_SECONDS); otherwise nothing is touched and
 * the answer is 401 { error: 'recent-login-required' }. Then, in this order:
 *
 *   1. the explorer's sightings, with every sub-collection (field notes, marvels, identifications,
 *      reports on them), their feed entries and review-queue items
 *   2. their uploads in Storage: snapshots/, videos/, audio/, avatars/, drafts/ under their uid
 *      (posters and transcodes live beside the clips), and the media_variants records of those files
 *   3. marvels (likes) they gave, field notes (comments) and identifications they wrote on other
 *      sightings: deleted, not anonymised, since they carry their name and words
 *   4. notifications they sent to others (needs the notifications.senderId collection-group index;
 *      skipped and reported if it is missing)
 *   5. follows both ways (with the other explorer's counter)
 *   6. letters: every conversation they are part of, with all its messages; reports about those
 *      conversations stay, marked closed
 *   7. the guide's answers (ai_results), AI activity and usage lines, feedback, live leases, reports
 *      they filed (reports about them are closed)
 *   8. guardian records: their consent record and parent links; teens whose consent they gave go back
 *      to a private notebook, as when a parent withdraws
 *   9. users/{uid} with every private sub-collection (drafts, exact places, notifications, saved,
 *      blocked, muted, push tokens), naturalist memories
 *  10. the sign-in account itself (Firebase Auth), last
 *
 * Every step works from what is still there, so a retry after a failure carries on where it stopped
 * (deletion_requests/{uid} records progress; it holds no personal data). Logs carry a short hash of the
 * uid, never names, emails or content. Moderation records (suspended/{uid}, the admin audit log) are kept.
 */
import crypto from 'crypto';
import { rateLimit } from 'express-rate-limit';
import { FieldValue, FieldPath } from 'firebase-admin/firestore';

export const RECENT_LOGIN_SECONDS = 10 * 60;
export const STORAGE_FOLDERS = ['snapshots', 'videos', 'audio', 'avatars', 'drafts'];
const PAGE = 300;

/** Short, non-reversible reference for logs. */
export const uidRef = (uid) => crypto.createHash('sha256').update(`ng-del:${uid}`).digest('hex').slice(0, 12);

/** null when the sign-in is recent enough to delete the account, else the refusal. */
export function recentLoginProblem(decoded, nowMs = Date.now()) {
  const authTime = Number(decoded?.auth_time ?? decoded?.authTime) || 0;
  if (!authTime || nowMs / 1000 - authTime > RECENT_LOGIN_SECONDS) {
    return { status: 401, body: { error: 'recent-login-required', message: 'For your security, please sign in again, then delete your account.' } };
  }
  return null;
}

const isMissingIndex = (e) => Number(e?.code) === 9 || /FAILED_PRECONDITION|requires an index/i.test(String(e?.message || ''));

/** Deletes everything the query returns, a page at a time (onDoc may add more writes to the batch). */
async function drain(db, query, onDoc = null) {
  let n = 0;
  for (;;) {
    const snap = await query.limit(PAGE).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) {
      if (onDoc) await onDoc(d, batch); else batch.delete(d.ref);
    }
    await batch.commit();
    n += snap.size;
    if (snap.size < PAGE) break;
  }
  return n;
}

/** Documents of a collection whose id starts with prefix (ai_usage/{uid}_{day}, media_variants/videos|{uid}|…). */
const byIdPrefix = (db, name, prefix) => db.collection(name)
  .where(FieldPath.documentId(), '>=', prefix).where(FieldPath.documentId(), '<', `${prefix}`);

/** Removes a sub-document written by this explorer and steps the parent post's counter down (and its feed entry's). */
async function drainWithCounter(db, query, counter) {
  let n = 0;
  for (;;) {
    const snap = await query.limit(PAGE).get();
    if (snap.empty) break;
    const postRefs = [...new Map(snap.docs.map(d => d.ref.parent.parent).filter(Boolean).map(r => [r.path, r])).values()];
    const thumbRefs = postRefs.map(r => db.doc(`feed_thumbnails/${r.id}`));
    const got = postRefs.length ? await db.getAll(...postRefs, ...thumbRefs) : [];
    const exists = new Map(got.map(s => [s.ref.path, s]));
    const steps = new Map();
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
      const p = d.ref.parent.parent;
      if (p && p.parent.id === 'ecosystem_feed') steps.set(p.id, (steps.get(p.id) || 0) + 1);
    }
    for (const [postId, k] of steps) {
      for (const path of [`ecosystem_feed/${postId}`, `feed_thumbnails/${postId}`]) {
        const s = exists.get(path);
        // Never below zero; the nightly reconcile (functions/index.js) makes counters exact again
        if (s?.exists && (Number(s.get(counter)) || 0) > 0) batch.update(s.ref, { [counter]: FieldValue.increment(-Math.min(k, Number(s.get(counter)) || 0)) });
      }
    }
    await batch.commit();
    n += snap.size;
    if (snap.size < PAGE) break;
  }
  return n;
}

/**
 * Runs every step for one uid. Returns { counts, skipped }. Throws with err.step on a failure; a later
 * call carries on (each step works from what is left).
 */
export async function deleteAccountData({ db, auth, bucket, log = () => {} }, uid) {
  const ref = uidRef(uid);
  const counts = {};
  const skipped = [];
  const progress = db.doc(`deletion_requests/${uid}`);
  let step = 'start';
  const mark = async (name) => {
    step = name;
    await progress.set({ uid, status: 'running', step: name, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  };
  const done = (name, n) => { counts[name] = (counts[name] || 0) + n; if (n) log('info', 'account deletion step', { ref, step: name, n }); };

  try {
    await progress.set({ uid, status: 'running', reason: 'self', attempts: FieldValue.increment(1), startedAt: FieldValue.serverTimestamp() }, { merge: true });

    // 1. Sightings, with all their sub-collections, feed entries and review items
    await mark('posts');
    for (;;) {
      const snap = await db.collection('ecosystem_feed').where('userId', '==', uid).limit(50).get();
      if (snap.empty) break;
      for (const p of snap.docs) {
        const extra = db.batch();
        extra.delete(db.doc(`feed_thumbnails/${p.id}`));
        extra.delete(db.doc(`review_queue/${p.id}`));
        await extra.commit();
        await db.recursiveDelete(p.ref);
      }
      done('posts', snap.size);
      if (snap.size < 50) break;
    }

    // 2. Uploads (the same folders storage.rules gives each explorer) and their transcode records
    await mark('media');
    if (bucket) {
      for (const folder of STORAGE_FOLDERS) {
        await bucket.deleteFiles({ prefix: `${folder}/${uid}/`, force: true });
      }
      done('mediaFolders', STORAGE_FOLDERS.length);
    } else {
      skipped.push('media: no storage bucket configured on the server');
    }
    for (const folder of ['videos', 'audio', 'drafts']) {
      done('mediaVariants', await drain(db, byIdPrefix(db, 'media_variants', `${folder}|${uid}|`)));
    }

    // 3. What they wrote or marked on other explorers' sightings
    await mark('likes');
    done('likes', await drainWithCounter(db, db.collectionGroup('likes').where('userId', '==', uid), 'likeCount'));
    for (const name of ['ecosystem_feed', 'feed_thumbnails']) {
      // Older posts keep likes as a list of uids
      done('likeLists', await (async () => {
        let n = 0;
        for (;;) {
          const snap = await db.collection(name).where('likes', 'array-contains', uid).limit(PAGE).get();
          if (snap.empty) break;
          const batch = db.batch();
          snap.docs.forEach(d => batch.update(d.ref, { likes: FieldValue.arrayRemove(uid) }));
          await batch.commit();
          n += snap.size;
          if (snap.size < PAGE) break;
        }
        return n;
      })());
    }
    await mark('comments');
    done('comments', await drainWithCounter(db, db.collectionGroup('comments').where('userId', '==', uid), 'commentCount'));
    await mark('identifications');
    // Identifications are stored under the identifier's uid; newer ones also carry userId. A scan by
    // document name finds older ones without needing a collection-group index.
    {
      let n = 0; let after = null; let scanned = 0;
      for (;;) {
        let q = db.collectionGroup('identifications').orderBy(FieldPath.documentId()).select().limit(1000);
        if (after) q = q.startAfter(after);
        const snap = await q.get();
        scanned += snap.size;
        const mine = snap.docs.filter(d => d.id === uid);
        if (mine.length) {
          const batch = db.batch();
          mine.forEach(d => batch.delete(d.ref));
          await batch.commit();
          n += mine.length;
        }
        if (snap.size < 1000) break;
        after = snap.docs[snap.size - 1];
      }
      done('identifications', n);
      counts.identificationsScanned = scanned;
    }

    // 4. Notifications they sent (carry their name)
    await mark('sentNotifications');
    try {
      done('sentNotifications', await drain(db, db.collectionGroup('notifications').where('senderId', '==', uid)));
    } catch (e) {
      if (!isMissingIndex(e)) throw e;
      skipped.push('sentNotifications: add a collection-group index on notifications.senderId');
      log('warn', 'account deletion skipped a step', { ref, step: 'sentNotifications', why: 'missing index' });
    }

    // 5. Follows both ways, with the other explorer's counter
    await mark('follows');
    const unlink = async (sub, otherSub, counter) => {
      let n = 0;
      for (;;) {
        const snap = await db.collection(`users/${uid}/${sub}`).limit(PAGE).get();
        if (snap.empty) break;
        const mirrors = snap.docs.map(d => db.doc(`users/${d.id}/${otherSub}/${uid}`));
        const owners = snap.docs.map(d => db.doc(`users/${d.id}`));
        const got = await db.getAll(...mirrors, ...owners);
        const batch = db.batch();
        snap.docs.forEach((d, i) => {
          const mirror = got[i]; const owner = got[snap.size + i];
          batch.delete(d.ref);
          if (mirror.exists) {
            batch.delete(mirror.ref);
            if (owner.exists && (Number(owner.get(counter)) || 0) > 0) batch.update(owner.ref, { [counter]: FieldValue.increment(-1) });
          }
        });
        await batch.commit();
        n += snap.size;
        if (snap.size < PAGE) break;
      }
      return n;
    };
    done('following', await unlink('following', 'followers', 'followersCount'));
    done('followers', await unlink('followers', 'following', 'followingCount'));

    // 6. Letters: whole conversations they are part of
    await mark('letters');
    for (;;) {
      const snap = await db.collection('conversations').where('participants', 'array-contains', uid).limit(50).get();
      if (snap.empty) break;
      for (const c of snap.docs) {
        const reports = await db.collection('letter_reports').where('cid', '==', c.id).limit(50).get();
        if (!reports.empty) {
          const batch = db.batch();
          reports.docs.forEach(r => batch.update(r.ref, { status: 'closed', closedReason: 'account-deleted', closedAt: FieldValue.serverTimestamp() }));
          await batch.commit();
        }
        await db.recursiveDelete(c.ref);
      }
      done('conversations', snap.size);
      if (snap.size < 50) break;
    }

    // 7. The guide's answers, AI activity, usage, feedback, leases, reports they filed
    await mark('records');
    done('aiResults', await drain(db, db.collection('ai_results').where('uid', '==', uid)));
    done('aiLog', await drain(db, db.collection('ai_log').where('uid', '==', uid)));
    done('aiUsage', await drain(db, byIdPrefix(db, 'ai_usage', `${uid}_`)));
    done('aiFeedback', await drain(db, db.collection('ai_feedback').where('userId', '==', uid)));
    done('liveLeases', await drain(db, db.collection('live_leases').where('uid', '==', uid)));
    done('reviewQueue', await drain(db, db.collection('review_queue').where('userId', '==', uid)));
    done('letterReports', await drain(db, db.collection('letter_reports').where('reporterId', '==', uid)));
    done('contentReports', await drain(db, db.collection('content_reports').where('reporterId', '==', uid)));
    done('contentReportsAbout', await drain(db, db.collection('content_reports').where('reportedUid', '==', uid).where('status', '==', 'open'),
      (d, batch) => batch.update(d.ref, { status: 'closed', outcome: 'account-deleted', closedAt: FieldValue.serverTimestamp() })));

    // 8. Guardian records
    await mark('guardian');
    done('guardianRequests', await drain(db, db.collection('guardian_requests').where('teenUid', '==', uid)));
    await db.doc(`guardian_consents/${uid}`).delete();
    // Teens whose consent this account gave: back to a private notebook, as when a parent withdraws
    {
      const snap = await db.collection('guardian_consents').where('parentUid', '==', uid).limit(100).get();
      for (const c of snap.docs) {
        const teenUid = c.id;
        const batch = db.batch();
        batch.set(c.ref, { status: 'withdrawn', parentUid: FieldValue.delete(), withdrawnAt: FieldValue.serverTimestamp(), history: FieldValue.arrayUnion({ event: 'guardian-account-deleted', at: new Date() }) }, { merge: true });
        batch.set(db.doc(`users/${teenUid}`), { guardian: { status: 'withdrawn', withdrawnAt: FieldValue.serverTimestamp() } }, { merge: true });
        const shared = await db.collection('ecosystem_feed').where('userId', '==', teenUid).where('isPublic', '==', true).limit(400).get();
        shared.docs.forEach(d => { batch.update(d.ref, { isPublic: false }); batch.delete(db.doc(`feed_thumbnails/${d.id}`)); });
        batch.set(db.collection(`users/${teenUid}/notifications`).doc(), {
          type: 'system', senderId: 'naturegram', senderName: 'NatureGram', isRead: false, timestamp: FieldValue.serverTimestamp(),
          message: 'The grown-up who said yes has closed their account, so your field page is private again. Ask a parent or guardian to say yes again to share.',
        });
        await batch.commit();
      }
      done('teensWithdrawn', snap.size);
    }

    // 9. The profile and every private sub-collection, naturalist memories
    await mark('profile');
    await db.doc(`naturalist_memories/${uid}`).delete();
    await db.recursiveDelete(db.doc(`users/${uid}`));
    done('profile', 1);

    // 10. The sign-in account, last
    await mark('auth');
    if (auth) {
      try { await auth.deleteUser(uid); } catch (e) {
        if (!/user-not-found/.test(String(e?.code || e?.errorInfo?.code || e?.message))) throw e;
      }
    } else {
      throw new Error('auth unavailable');
    }

    await progress.set({ status: 'completed', step: 'done', completedAt: FieldValue.serverTimestamp(), skipped }, { merge: true });
    log('info', 'account deleted', { ref, skipped: skipped.length });
    return { counts, skipped };
  } catch (e) {
    await progress.set({ status: 'failed', step, failedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    log('error', 'account deletion stopped', { ref, step, error: String(e?.message || e).slice(0, 160) });
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { step });
  }
}

export function mountAccountDeletion(app, deps) {
  const { bearer, log } = deps;
  const limiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

  app.delete('/api/me', limiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const db = deps.db(); const auth = deps.auth?.();
    if (!db || !auth) return res.status(503).json({ error: 'unavailable', message: 'Account deletion is unavailable for a moment. Nothing was deleted. Please try again.' });
    const token = String(bearer(req) || '');
    if (!token || token.length > 4096) return res.status(401).json({ error: 'auth', message: 'Please sign in again.' });
    let decoded;
    try {
      decoded = await auth.verifyIdToken(token, true); // signature, expiry and revocation
    } catch (e) {
      const code = String(e?.code || e?.errorInfo?.code || '');
      if (/insufficient-permission|PERMISSION_DENIED/i.test(code + ' ' + String(e?.message || ''))) {
        log('warn', 'account deletion cannot check sign-ins', { code });
        return res.status(503).json({ error: 'unavailable', message: 'Account deletion is unavailable for a moment. Nothing was deleted. Please try again.' });
      }
      return res.status(401).json({ error: 'auth', message: 'Please sign in again.' });
    }
    const recent = recentLoginProblem(decoded);
    if (recent) return res.status(recent.status).json(recent.body);
    let bucket = null;
    try { bucket = deps.bucket ? deps.bucket() : null; } catch { bucket = null; }
    try {
      const out = await deleteAccountData({ db, auth, bucket, log }, decoded.uid);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ error: 'deletion-incomplete', step: e.step || null, message: 'Deletion could not finish. Please try again: it carries on from where it stopped.' });
    }
  });
}
