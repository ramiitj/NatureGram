/**
 * Admin-controlled settings: the single source of truth for every limit, switch and prompt.
 *
 * Two documents:
 *  - app_config/flags      public: switches and daily allowances the app shows to explorers.
 *  - admin_private/settings private: prompts, policy, models, caps, budgets, blocked networks.
 *    Only the server (Admin SDK) and the admin console (through the server) read it.
 *
 * The server caches both for a short time so a change in the admin console takes effect
 * within CACHE_MS everywhere, with no app release. When Firestore is unreachable the last
 * known values are kept; with no known values the defaults below apply (fail closed on
 * anything that would loosen a limit).
 */
import { FieldValue } from 'firebase-admin/firestore';
import { DEFAULT_PROMPTS, DEFAULT_POLICY } from './aiDefaults.js';

const CACHE_MS = 30_000;

export const DEFAULT_FLAGS = Object.freeze({
  aiEnabled: true,          // every AI feature
  liveEnabled: true,        // live guide
  uploadsEnabled: true,     // publishing new sightings
  guestsEnabled: true,      // guest (anonymous) access to AI
  lettersEnabled: true,     // letters (direct messages)
  signupsEnabled: true,     // new accounts
  allowances: Object.freeze({
    postsPerDay: 3,
    liveMinutesPerDay: 3,
    identificationsPerDay: 15,
    privateSavesPerDay: 200,  // "Only me" saves: a generous anti-abuse cap, separate from sharing
  }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  prompts: DEFAULT_PROMPTS,          // { live, identify, describe, curate, synthesize, moderate }
  policy: DEFAULT_POLICY,
  models: Object.freeze({
    live: 'models/gemini-2.5-flash-native-audio-latest',
    identify: process.env.MODEL_IDENTIFY || process.env.MODEL_FAST || 'gemini-3.6-flash',
    describe: process.env.MODEL_DESCRIBE || process.env.MODEL_FAST || 'gemini-3.6-flash',
    curate: process.env.MODEL_CURATE || process.env.MODEL_FAST || 'gemini-3.6-flash',
    synthesize: process.env.MODEL_SYNTHESIZE || process.env.MODEL_FAST || 'gemini-3.6-flash',
    moderate: process.env.MODEL_MODERATE || process.env.MODEL_FAST || 'gemini-3.6-flash',
  }),
  caps: Object.freeze({
    maxOutputTokens: 2048,           // per answer
    thinkingBudget: 512,             // per answer, where the model supports it
    otherAiCallsPerDay: 20,          // describe + curate + synthesize, per account
    dailyTokenCeiling: 5_000_000,    // all accounts together; the AI pauses for everyone above it
    liveSessionsPerNetworkPerHour: 20,
    liveConcurrentPerNetwork: 4,
  }),
  // Words explorers see when a capture is held back. Admin-editable.
  guidance: Object.freeze({
    people: 'Someone is in the frame. Crop them out or retake the photo before sharing.',
    faces: 'A face is visible. Crop it out or blur it before sharing.',
    plates: 'A vehicle number plate is visible. Crop it out before sharing.',
    screen: 'This looks like a screen, document or screenshot. NatureGram is for wild plants, animals, fungi and natural sounds.',
    notNature: 'There is no plant, animal, fungus or natural sound in view. Try again with the living thing in frame.',
    sensitive: 'This species is protected. Your exact location will be hidden on this sighting.',
    caption: 'Captions and field notes can\'t contain links, contact details or promotions.',
    safety: 'Field notes can\'t say a wild plant, fungus or animal is safe to eat, touch or use as medicine.',
  }),
  blockedNetworks: Object.freeze([]), // IP addresses or prefixes, e.g. "203.0.113." or "198.51.100.7"
  moderationWords: Object.freeze([]), // extra words that send a sighting or comment to review (whole words, any case)
  requireAdminMfa: process.env.ADMIN_REQUIRE_MFA === 'true',
});

let db = null;
let flagsCache = { value: DEFAULT_FLAGS, at: 0, known: false };
let settingsCache = { value: DEFAULT_SETTINGS, at: 0, known: false };

export function initSettings(firestore) { db = firestore; }

/** Deep-merge saved values over defaults so a partly-filled document never drops a field. */
function merge(defaults, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(defaults)) return saved ?? defaults;
  const out = { ...defaults };
  for (const [k, v] of Object.entries(saved)) {
    out[k] = defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) ? merge(defaults[k], v) : v;
  }
  return out;
}

async function load(cache, path, defaults) {
  if (Date.now() - cache.at < CACHE_MS) return cache.value;
  if (!db) return cache.value;
  try {
    const snap = await db.doc(path).get();
    cache.value = merge(defaults, snap.exists ? snap.data() : {});
    cache.known = true;
  } catch {
    // keep last known values
  }
  cache.at = Date.now();
  return cache.value;
}

export const getFlags = () => load(flagsCache, 'app_config/flags', DEFAULT_FLAGS);
export const getSettings = () => load(settingsCache, 'admin_private/settings', DEFAULT_SETTINGS);

/** Saves a change, keeps the previous version in history, and refreshes the cache at once. */
export async function saveSection(kind, patch, actor) {
  if (!db) throw new Error('Settings store unavailable');
  const path = kind === 'flags' ? 'app_config/flags' : 'admin_private/settings';
  const ref = db.doc(path);
  const before = (await ref.get()).data() || {};
  await db.collection(kind === 'flags' ? 'admin_private/history/flags' : 'admin_private/history/settings').add({
    before, patch, by: actor.uid, email: actor.email || null, at: FieldValue.serverTimestamp(),
  });
  await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true });
  if (kind === 'flags') flagsCache.at = 0; else settingsCache.at = 0;
  return kind === 'flags' ? getFlags() : getSettings();
}

/** Recent versions of a section, newest first, for history and rollback. */
export async function listHistory(kind, max = 30) {
  if (!db) return [];
  const snap = await db.collection(kind === 'flags' ? 'admin_private/history/flags' : 'admin_private/history/settings')
    .orderBy('at', 'desc').limit(max).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data(), at: d.get('at')?.toMillis?.() || null }));
}

// ------------------------------------------------------------------ blocked networks
// An entry is one exact address ("203.0.113.7"), a prefix that ends at a boundary ("203.0.113." or
// "2001:db8:"), or a CIDR range ("203.0.113.0/24", "2001:db8::/32"). A bare "203.0.113.1" blocks that
// address only, never 203.0.113.10 to .199.
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const v4Number = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
/** IPv6 address -> BigInt, or null. Accepts "::" shortening and an IPv4 tail. */
function v6Number(ip) {
  let s = String(ip).toLowerCase();
  if (s.includes('.')) {
    const at = s.lastIndexOf(':');
    const tail = s.slice(at + 1);
    if (!IPV4.test(tail)) return null;
    const n = v4Number(tail);
    s = `${s.slice(0, at + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.reduce((n, g) => (n << 16n) + BigInt(parseInt(g, 16)), 0n);
}
/** Plain form of a client address: "::ffff:203.0.113.7" -> "203.0.113.7". */
export const normalIp = (ip) => {
  const s = String(ip || '').trim().toLowerCase();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  return m ? m[1] : s;
};
/** Whether an admin entry is one the matcher understands (used to validate the Admin list). */
export function validNetworkEntry(p) {
  if (typeof p !== 'string' || p.length < 2 || p.length > 49) return false;
  const cidr = /^(.+)\/(\d{1,3})$/.exec(p);
  if (cidr) {
    const bits = Number(cidr[2]);
    if (IPV4.test(cidr[1])) return bits >= 8 && bits <= 32;
    return v6Number(cidr[1]) !== null && bits >= 16 && bits <= 128;
  }
  if (IPV4.test(p) || v6Number(p) !== null) return true;
  // Prefixes must end at a boundary
  if (/^(\d{1,3}\.){1,3}$/.test(p)) return p.split('.').filter(Boolean).every(o => Number(o) <= 255);
  return /^[0-9a-f]{1,4}(:[0-9a-f]{1,4}){0,6}:$/i.test(p);
}
export function networkMatches(entry, rawIp) {
  const p = String(entry || '').trim().toLowerCase();
  const ip = normalIp(rawIp);
  if (!p || !ip) return false;
  const cidr = /^(.+)\/(\d{1,3})$/.exec(p);
  if (cidr) {
    const bits = Number(cidr[2]);
    if (IPV4.test(cidr[1])) {
      if (!IPV4.test(ip) || bits < 0 || bits > 32) return false;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return ((v4Number(ip) & mask) >>> 0) === ((v4Number(cidr[1]) & mask) >>> 0);
    }
    const base = v6Number(cidr[1]); const n = v6Number(ip);
    if (base === null || n === null || bits > 128) return false;
    const shift = BigInt(128 - bits);
    return (n >> shift) === (base >> shift);
  }
  if (p.endsWith('.') || p.endsWith(':')) return ip.startsWith(p);
  if (IPV4.test(p)) return ip === p;
  // An older saved entry with fewer than four parts ("203.0.113") means that whole range
  if (/^\d{1,3}(\.\d{1,3}){0,2}$/.test(p)) return ip.startsWith(`${p}.`);
  const a = v6Number(p); const b = v6Number(ip);
  return a !== null && b !== null ? a === b : ip === p;
}
export const ipBlocked = (settings, ip) => !!ip && (settings.blockedNetworks || []).some(p => networkMatches(p, ip));
