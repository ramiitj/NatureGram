/**
 * Shared live-session concurrency, across every server instance.
 *
 * Each open live session holds a lease document in `live_leases/{id}`:
 *   { uid, kind: 'proxy' | 'direct', instance, startedAt, heartbeatAt, expiresAt, expireAt }
 * The holder refreshes `expiresAt` every HEARTBEAT_MS; a lease whose `expiresAt` has passed is
 * ignored when counting (a crashed instance or a closed tab frees its slot within LEASE_TTL_MS).
 * Leases are deleted when the session ends. `expireAt` is a Firestore TTL field so forgotten
 * documents are cleaned up even if nothing deletes them.
 *
 * Direct (ephemeral-token) sessions also carry billing fields:
 *   { mintedAt, sessionExpireAt, lastBeatAt, settled }
 * They stay until settled: by the explorer's end report, or by the sweeper charging the
 * token's full lifetime (the upper bound) when no report arrives.
 *
 * If the shared store is missing or refuses (for example PERMISSION_DENIED for the server's
 * service account), acquire() returns { ok: true, shared: false } and the caller relies on its
 * per-instance in-memory cap. Live never breaks because the shared count is unavailable.
 */
import crypto from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';

export const HEARTBEAT_MS = 30_000;
export const LEASE_TTL_MS = 90_000;
const INSTANCE = process.env.K_REVISION ? `${process.env.K_REVISION}:${crypto.randomBytes(3).toString('hex')}` : `local:${process.pid}`;
const TIMEOUT_MS = 2500;

let db = null;
let degradedUntil = 0; // after a failure, skip the shared store briefly instead of waiting on it each time
let lastError = null;
const stats = { acquired: 0, refusedUser: 0, refusedGlobal: 0, fallback: 0 };

export const initLeases = (firestore) => { db = firestore; };
export const leaseHealth = () => ({ shared: Boolean(db) && Date.now() >= degradedUntil, lastError, instance: INSTANCE, ...stats });

const withTimeout = (p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('lease store timeout')), TIMEOUT_MS))]);
const degrade = (e) => {
  lastError = String(e?.message || e).slice(0, 160);
  degradedUntil = Date.now() + 60_000;
  stats.fallback++;
};
const live = (doc, now) => (doc.get('expiresAt')?.toMillis?.() || 0) > now;
const unsettledDirect = (doc) => doc.get('kind') === 'direct' && doc.get('settled') !== true;

/**
 * Take a slot. perUser and global are maxima (0 = no global cap).
 * Returns { ok, shared, id?, reason? }. reason is 'user' or 'global' when refused.
 */
export async function acquire(uid, { perUser = 1, global = 0, kind = 'proxy', extra = {} } = {}) {
  if (!db || Date.now() < degradedUntil) { stats.fallback++; return { ok: true, shared: false }; }
  const now = Date.now();
  try {
    if (global > 0) {
      const snap = await withTimeout(db.collection('live_leases').where('expiresAt', '>', Timestamp.fromMillis(now)).count().get());
      if (snap.data().count >= global) { stats.refusedGlobal++; return { ok: false, shared: true, reason: 'global' }; }
    }
    const ref = db.collection('live_leases').doc();
    const res = await withTimeout(db.runTransaction(async (tx) => {
      const mine = await tx.get(db.collection('live_leases').where('uid', '==', uid).limit(50));
      const active = mine.docs.filter(d => live(d, now));
      if (active.length >= perUser) return { ok: false, reason: 'user' };
      // Tidy this explorer's stale leases (never a direct session that still has to be charged)
      for (const d of mine.docs) if (!live(d, now) && !unsettledDirect(d)) tx.delete(d.ref);
      tx.set(ref, {
        uid, kind, instance: INSTANCE,
        startedAt: Timestamp.fromMillis(now), heartbeatAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + LEASE_TTL_MS),
        expireAt: Timestamp.fromMillis(now + 2 * 86_400_000),
        ...extra,
      });
      return { ok: true };
    }));
    if (!res.ok) { stats.refusedUser++; return { ok: false, shared: true, reason: res.reason }; }
    stats.acquired++;
    lastError = null;
    return { ok: true, shared: true, id: ref.id };
  } catch (e) {
    degrade(e);
    return { ok: true, shared: false };
  }
}

/** Keep a lease alive. Returns false if the lease is gone (or the store is unavailable). */
export async function heartbeat(id, uid = null) {
  if (!db || !id) return false;
  const now = Date.now();
  try {
    const ref = db.doc(`live_leases/${id}`);
    if (uid) {
      const snap = await withTimeout(ref.get());
      if (!snap.exists || snap.get('uid') !== uid) return false;
    }
    await withTimeout(ref.update({ heartbeatAt: Timestamp.fromMillis(now), lastBeatAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + LEASE_TTL_MS) }));
    return true;
  } catch { return false; }
}

/** Free the slot. */
export async function release(id) {
  if (!db || !id) return;
  try { await withTimeout(db.doc(`live_leases/${id}`).delete()); } catch { /* the lease expires on its own */ }
}

/** Starts a heartbeat for a server-held lease; returns a stop function that also releases it. */
export function hold(lease) {
  if (!lease?.shared || !lease.id) return () => {};
  const t = setInterval(() => { heartbeat(lease.id); }, HEARTBEAT_MS);
  t.unref?.();
  let stopped = false;
  return () => { if (stopped) return; stopped = true; clearInterval(t); release(lease.id); };
}

// ------------------------------------------------------------------------- direct sessions (billing)

/** Read a direct-session lease that belongs to uid. */
export async function getDirect(id, uid) {
  if (!db || !id || !/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
  const snap = await withTimeout(db.doc(`live_leases/${id}`).get());
  if (!snap.exists || snap.get('uid') !== uid || snap.get('kind') !== 'direct') return null;
  return { ref: snap.ref, data: snap.data() };
}

/**
 * How long to charge for a direct session.
 *  - With an end report: what the app says, but at least up to its last heartbeat and never
 *    more than the time since the token was minted or the token's own lifetime.
 *  - Without one (sweeper): the token's full lifetime, the upper bound.
 */
export function chargeableMs(data, { reportedMs = null, now = Date.now() } = {}) {
  const minted = data.mintedAt?.toMillis?.() || 0;
  const cap = Math.max(0, (data.sessionExpireAt?.toMillis?.() || minted) - minted);
  if (reportedMs === null) return cap;
  const sinceMint = Math.max(0, now - minted);
  const beat = Math.max(0, (data.lastBeatAt?.toMillis?.() || minted) - minted);
  const ms = Math.max(Number(reportedMs) || 0, beat);
  return Math.min(ms, sinceMint, cap);
}

/** Settle a direct session exactly once. `charge(uid, ms, data)` records the minutes. */
export async function settleDirect(ref, charge, opts = {}) {
  let out = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('settled') === true) return;
    const data = snap.data();
    out = { uid: data.uid, ms: chargeableMs(data, opts), data };
    tx.delete(ref);
  });
  if (out) await charge(out.uid, out.ms, out.data);
  return out;
}

/** Charge direct sessions whose token has expired without an end report (any instance may run it). */
export async function sweepDirect(charge, log) {
  if (!db || Date.now() < degradedUntil) return 0;
  let n = 0;
  try {
    const snap = await withTimeout(db.collection('live_leases').where('sessionExpireAt', '<', Timestamp.fromMillis(Date.now() - 60_000)).limit(100).get());
    for (const d of snap.docs) {
      if (!unsettledDirect(d)) continue;
      const r = await settleDirect(d.ref, charge).catch(() => null);
      if (r) n++;
    }
  } catch (e) { log?.('warn', 'live sweep failed', { error: String(e.message).slice(0, 120) }); }
  return n;
}
