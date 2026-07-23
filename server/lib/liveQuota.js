/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Firestore-backed session tracking — replaces the previous in-memory Maps.
// Those reset on restart and, more importantly, silently stopped enforcing
// anything correctly the moment more than one server replica ran (each
// replica had its own independent Map, so a user could get
// MAX_CONCURRENT_LIVE_SESSIONS *per replica*). This was flagged in this
// file's own prior comment as a hard scaling ceiling; this is the fix.
//
// Both checks below fail CLOSED (deny) on a Firestore error. This is a
// cost/abuse control on the most expensive thing this app does (realtime
// audio+video against a native-audio model) — silently falling back to
// "allow" during a Firestore outage would defeat the entire point of
// having a quota. Requires the server process to have working Google Cloud
// Application Default Credentials with Firestore access (e.g. Cloud Run's
// attached service account); this can't be exercised end-to-end in a
// sandbox without real GCP credentials, same limitation as every other
// "needs a live environment" feature in this project.
//
// getFirestore() is called lazily (on first actual use, not at module load)
// and memoized: ES module imports are hoisted and evaluated before
// server.js's own body runs initFirebaseAdmin()/admin.initializeApp(), so
// calling getFirestore() at this file's top level would run before any
// Firebase app exists and throw immediately, crashing the server on boot.
let dbInstance = null;
const getDb = () => {
  if (!dbInstance) dbInstance = getFirestore();
  return dbInstance;
};

export const MAX_CONCURRENT_LIVE_SESSIONS = parseInt(process.env.MAX_CONCURRENT_LIVE_SESSIONS || '1', 10);
export const MAX_DAILY_LIVE_SESSIONS = parseInt(process.env.MAX_DAILY_LIVE_SESSIONS || '20', 10);

// A connection entry older than this is treated as stale and pruned the
// next time anyone's concurrency is checked — comfortably longer than the
// 3-minute hard session cap in geminiProxy.js, so a live connection is
// never pruned out from under itself. This is the crash-recovery path: if
// a server process dies before a connection's close handler runs (so
// releaseConnection never fires), the leaked entry self-heals on the next
// check instead of permanently locking that user out.
const STALE_CONNECTION_MS = 10 * 60 * 1000;

// Returns true and records the attempt if `uid` is still under its daily
// Live session quota; returns false (without recording) if today's quota
// is already spent.
export async function tryConsumeDailyLiveSession(uid) {
  const today = new Date().toISOString().slice(0, 10);
  const db = getDb();
  const ref = db.collection('live_quota').doc(uid);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      if (!data || data.date !== today) {
        tx.set(ref, { date: today, count: 1 });
        return true;
      }
      if (data.count >= MAX_DAILY_LIVE_SESSIONS) {
        return false;
      }
      tx.update(ref, { count: FieldValue.increment(1) });
      return true;
    });
  } catch (e) {
    console.error('[liveQuota] Firestore daily-quota check failed, denying:', e.message);
    return false;
  }
}

// Atomically checks-and-reserves one concurrent-session slot for `uid`,
// keyed by a per-connection id (a WebSocket instance itself can't be
// stored as a Firestore value, unlike the old in-memory Set<WebSocket>).
// Returns false if the user is already at MAX_CONCURRENT_LIVE_SESSIONS
// (after pruning stale entries).
export async function tryReserveConnection(uid, connectionId) {
  const db = getDb();
  const ref = db.collection('live_connections').doc(uid);
  const now = Date.now();
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data().connections || {}) : {};
      const fresh = {};
      for (const [id, ts] of Object.entries(existing)) {
        if (now - ts < STALE_CONNECTION_MS) fresh[id] = ts;
      }
      if (Object.keys(fresh).length >= MAX_CONCURRENT_LIVE_SESSIONS) {
        return false;
      }
      fresh[connectionId] = now;
      tx.set(ref, { connections: fresh });
      return true;
    });
  } catch (e) {
    console.error('[liveQuota] Firestore concurrency check failed, denying:', e.message);
    return false;
  }
}

// Releases a previously reserved connection slot. Called from a WebSocket
// close/error handler, which should never block or throw on teardown — a
// failure here just means this entry lingers until STALE_CONNECTION_MS
// prunes it via tryReserveConnection's next check, instead of being freed
// immediately.
export async function releaseConnection(uid, connectionId) {
  const ref = getDb().collection('live_connections').doc(uid);
  try {
    await ref.update({ [`connections.${connectionId}`]: FieldValue.delete() });
  } catch (e) {
    console.warn('[liveQuota] Failed to release connection slot:', e.message);
  }
}
