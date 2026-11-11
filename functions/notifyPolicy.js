/**
 * Which in-app notifications also become a push, and how (functions/index.js, sendActivityPush).
 * The in-app Activity list always records every notification; this only decides the push.
 *
 * users/{uid}.notifyPrefs (written by the explorer; firestore.rules checks the shape):
 *   { marvels?: boolean = false, notes?: boolean = true, follows?: boolean = true,
 *     identifications?: boolean = true, letters?: boolean = true, quietHours?: boolean = true }
 * Quiet hours are 21:00 to 07:00 India time (IST, UTC+5:30), and always on for teens.
 * Pure functions, no Firebase imports, so the server tests can load them.
 */
export const PREF_DEFAULTS = Object.freeze({ marvels: false, notes: true, follows: true, identifications: true, letters: true, quietHours: true });

/** Notification type -> the switch that governs its push. Types not listed (review, system) always push. */
export const TYPE_PREF = Object.freeze({
  like: 'marvels', comment: 'notes', reply: 'notes', mention: 'notes',
  follow: 'follows', identification: 'identifications', message: 'letters',
});

export const TITLES = Object.freeze({
  like: 'New marvels', comment: 'New field notes', reply: 'New replies to your field notes', mention: 'You were mentioned',
  follow: 'New followers', identification: 'New identifications', message: 'New letters',
  review: 'Your sighting was reviewed', system: 'NatureGram',
});

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : t instanceof Date ? t.getTime() : typeof t === 'number' ? t : t?._seconds ? t._seconds * 1000 : t?.seconds ? t.seconds * 1000 : 0);

/** Same rule as server/guardian.js bandOf: a teen until adultFrom passes. */
export function isTeenProfile(profile, now = Date.now()) {
  if (!profile || profile.ageBand !== 'teen') return false;
  const from = ms(profile.adultFrom);
  return !(from && from <= now);
}

/** The explorer's switches with defaults filled in (only true/false values are read). */
export function prefsFor(profile, now = Date.now()) {
  const saved = profile && typeof profile.notifyPrefs === 'object' && profile.notifyPrefs ? profile.notifyPrefs : {};
  const out = { ...PREF_DEFAULTS };
  for (const k of Object.keys(PREF_DEFAULTS)) if (typeof saved[k] === 'boolean') out[k] = saved[k];
  if (isTeenProfile(profile, now)) out.quietHours = true;
  return out;
}

/** 21:00 to 07:00 in India (UTC+5:30, no daylight saving). */
export function inQuietHours(now = Date.now()) {
  const minutes = Math.floor(now / 60_000);
  const ist = ((minutes + 330) % 1440 + 1440) % 1440;
  return ist >= 21 * 60 || ist < 7 * 60;
}

/** One tag per kind of event and sighting, so repeats replace each other instead of stacking. */
export function tagFor(n) {
  const type = String(n?.type || 'activity').replace(/[^a-z]/gi, '').slice(0, 20) || 'activity';
  const key = n?.postId ? String(n.postId) : (type === 'message' && n?.senderId ? String(n.senderId) : '');
  return `ng-${type}${key ? `-${key.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}` : ''}`.slice(0, 64);
}

/**
 * { send: false, reason } or { send: true, title, body, tag, url }.
 * reason: 'off' (switched off), 'quiet' (quiet hours), 'empty' (nothing to show).
 */
export function pushDecision(n, profile, now = Date.now()) {
  if (!n || typeof n !== 'object') return { send: false, reason: 'empty' };
  const prefs = prefsFor(profile, now);
  const pref = TYPE_PREF[n.type];
  if (pref && prefs[pref] === false) return { send: false, reason: 'off' };
  if (prefs.quietHours && inQuietHours(now)) return { send: false, reason: 'quiet' };
  const url = n.type === 'follow' && n.senderId ? `/profile?user=${n.senderId}` : (n.postId ? `/feed?p=${n.postId}` : (n.type === 'message' ? '/messages' : '/feed'));
  return { send: true, title: TITLES[n.type] || 'NatureGram', body: String(n.message || '').slice(0, 180), tag: tagFor(n), url };
}
