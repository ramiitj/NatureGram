/**
 * Shared counters and records, held in Firestore so they apply across every server instance.
 *
 *  - Per-account daily allowances: ai_usage/{uid}_{day}  { identify, other, liveMs, posts }
 *  - All-accounts daily token total: usage_global/{day}   { tokens, calls }
 *  - AI activity log (no content, 30-day expiry): ai_log/{auto}
 *  - Suspended accounts: suspended/{uid}
 *
 * Counters fail closed: if the shared store can't be reached, the request is refused rather
 * than allowed past the admin's limit. Set QUOTA_FAIL_OPEN=true only for local development.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

let db = null;
export const initLedger = (firestore) => { db = firestore; };
const FAIL_OPEN = process.env.QUOTA_FAIL_OPEN === 'true';
export const today = () => new Date().toISOString().slice(0, 10);
// Daily allowances turn over at midnight UTC. Explorers are mostly in India, so say it in their time first.
export const RESET_WORDS = 'at 5:30 am India time (midnight UTC)';
/** The next turnover (next midnight UTC) as an ISO string. */
export const nextResetMs = (now = Date.now()) => new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z').getTime() + 86_400_000;
export const nextReset = (now = Date.now()) => new Date(nextResetMs(now)).toISOString();
const expiry = (days) => Timestamp.fromMillis(Date.now() + days * 86_400_000);

let healthy = { ok: true, at: 0, error: null };
export const storeHealth = () => ({ ...healthy });
const markFailure = (e) => { healthy = { ok: false, at: Date.now(), error: String(e?.message || e).slice(0, 200) }; };
const markOk = () => { if (!healthy.ok) healthy = { ok: true, at: Date.now(), error: null }; };

/**
 * Atomically add `amount` to an allowance if it stays within `limit`.
 * Returns { ok, used, limit } or { ok:false, unavailable:true }.
 */
export async function charge(uid, field, amount, limit) {
  if (!db) return FAIL_OPEN ? { ok: true, used: 0, limit } : { ok: false, unavailable: true };
  const ref = db.doc(`ai_usage/${uid}_${today()}`);
  try {
    const res = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? (snap.get(field) || 0) : 0;
      if (amount > 0 && current + amount > limit) return { ok: false, used: current, limit };
      tx.set(ref, { uid, day: today(), [field]: current + amount, updatedAt: FieldValue.serverTimestamp(), expireAt: expiry(3) }, { merge: true });
      return { ok: true, used: current + amount, limit };
    });
    markOk();
    return res;
  } catch (e) {
    markFailure(e);
    return FAIL_OPEN ? { ok: true, used: 0, limit } : { ok: false, unavailable: true };
  }
}

/** Add usage that has already happened (for example live minutes at the end of a session). */
export async function record(uid, field, amount) {
  if (!db || !amount) return;
  try {
    await db.doc(`ai_usage/${uid}_${today()}`).set({ uid, day: today(), [field]: FieldValue.increment(amount), updatedAt: FieldValue.serverTimestamp(), expireAt: expiry(3) }, { merge: true });
    markOk();
  } catch (e) { markFailure(e); }
}

/** Today's usage for one account: what the app shows as "left today". */
export async function usageFor(uid) {
  if (!db) return FAIL_OPEN ? {} : null;
  try {
    const snap = await db.doc(`ai_usage/${uid}_${today()}`).get();
    markOk();
    return snap.exists ? snap.data() : {};
  } catch (e) { markFailure(e); return null; }
}

// ---------------------------------------------------------------- spending ceiling (all accounts)
let globalCache = { day: null, tokens: 0, at: 0 };
export async function globalTokensToday() {
  const d = today();
  if (globalCache.day === d && Date.now() - globalCache.at < 15_000) return globalCache.tokens;
  if (!db) return 0;
  try {
    const snap = await db.doc(`usage_global/${d}`).get();
    globalCache = { day: d, tokens: snap.exists ? (snap.get('tokens') || 0) : 0, at: Date.now() };
    markOk();
  } catch (e) { markFailure(e); }
  return globalCache.tokens;
}
export async function addGlobalTokens(tokens) {
  if (!db || !tokens) return;
  globalCache.tokens += tokens;
  try {
    await db.doc(`usage_global/${today()}`).set({ day: today(), tokens: FieldValue.increment(tokens), calls: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (e) { markFailure(e); }
}

// ---------------------------------------------------------------- AI activity log
/** One line per AI call: who, which task and model, size, outcome and any flags. Never content. */
export function logAi(entry) {
  if (!db) return;
  db.collection('ai_log').add({ ...entry, at: FieldValue.serverTimestamp(), expireAt: expiry(30) }).catch(markFailure);
}

// ---------------------------------------------------------------- suspensions
let suspendedCache = { set: new Set(), at: 0 };
export async function isSuspended(uid) {
  if (!db) return false;
  if (Date.now() - suspendedCache.at > 30_000) {
    try {
      const snap = await db.collection('suspended').get();
      suspendedCache = { set: new Set(snap.docs.map(d => d.id)), at: Date.now() };
    } catch (e) { markFailure(e); suspendedCache.at = Date.now(); }
  }
  return suspendedCache.set.has(uid);
}
export const refreshSuspended = () => { suspendedCache.at = 0; };

// ---------------------------------------------------------------- admin audit log
/** Append-only record of every admin action. Clients can never write or delete it. */
export async function audit(actor, action, details = {}) {
  if (!db) return;
  try {
    await db.collection('admin_audit').add({
      action, details, by: actor.uid, email: actor.email || null, ip: actor.ip || null,
      at: FieldValue.serverTimestamp(),
    });
  } catch (e) { markFailure(e); }
}
