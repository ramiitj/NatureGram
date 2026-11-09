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

export const ipBlocked = (settings, ip) => !!ip && (settings.blockedNetworks || []).some(p => p && (ip === p || ip.startsWith(p)));
