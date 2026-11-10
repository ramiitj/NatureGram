/**
 * One true count: an explorer's species and sightings, worked out the same way everywhere.
 *
 *  - sightings: the explorer's public sightings (isPublic === true), one per post
 *  - species:   distinct names on those public sightings, with the life-list naming rules
 *               (services/lifeList.ts buildLifeList): the first label, trimmed and compared
 *               without case; placeholder names ("Unknown", "Nature", "Captured photo"…) don't count
 *
 * The server writes the result to users/{uid}.stats.species, stats.sightings and stats.reconciledAt
 * (on publish, on a change of visibility, on delete through the Cloud Function, and nightly).
 * Clients cannot write `stats` (firestore.rules). Until reconciledAt exists, the app shows no count.
 *
 * functions/userStats.js is a byte-for-byte copy (Cloud Functions deploy only their own folder);
 * server/test/userStats.test.mjs checks the two stay identical and agree with the app's life list.
 */

/** Same pattern as IGNORE in services/lifeList.ts. */
export const IGNORE_NAME = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting)/i;

/** The life-list key for a sighting's name, or '' if it names nothing. */
export function speciesKey(post) {
  const name = String((post && Array.isArray(post.labels) && post.labels[0]) || '').trim();
  if (!name || IGNORE_NAME.test(name)) return '';
  return name.toLowerCase();
}

/** { species, sightings } from a list of post documents (any visibility; only public ones count). */
export function statsFromPosts(posts) {
  const keys = new Set();
  let sightings = 0;
  for (const p of posts || []) {
    if (!p || p.isPublic !== true) continue;
    sightings++;
    const k = speciesKey(p);
    if (k) keys.add(k);
  }
  return { species: keys.size, sightings };
}

/** Would this change of a post move its author's counts? (create, delete, visibility or name) */
export function affectsStats(before, after) {
  if (!before || !after) return true;
  if ((before.isPublic === true) !== (after.isPublic === true)) return true;
  if (before.userId !== after.userId) return true;
  return (before.isPublic === true || after.isPublic === true) && speciesKey(before) !== speciesKey(after);
}

/**
 * Recount one explorer from their posts and save it. Reads only the fields it needs.
 * `FieldValue` is passed in so this file needs no firebase-admin import of its own.
 */
export async function recomputeUserStats(db, uid, FieldValue) {
  if (!db || !uid) return null;
  const snap = await db.collection('ecosystem_feed').where('userId', '==', uid).select('isPublic', 'labels').get();
  const stats = statsFromPosts(snap.docs.map(d => d.data()));
  const ref = db.doc(`users/${uid}`);
  const user = await ref.get();
  // A deleted account stays deleted: never recreate the profile just to hold numbers
  if (!user.exists) return stats;
  await ref.set({ stats: { species: stats.species, sightings: stats.sightings, reconciledAt: FieldValue.serverTimestamp() } }, { merge: true });
  return stats;
}
