/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// In-memory session tracking. Resets on server restart; fine for a single
// instance, but should move to Firestore/Redis before running >1 replica.
const userSessions = new Map(); // uid -> { date: string, count: number }
export const activeConnections = new Map(); // uid -> Set<WebSocket>

// Live sessions are the most expensive thing this app does (realtime
// audio+video against a native-audio model), so cap both how many a user
// can have open at once and how many they can start per day.
export const MAX_CONCURRENT_LIVE_SESSIONS = parseInt(process.env.MAX_CONCURRENT_LIVE_SESSIONS || '1', 10);
export const MAX_DAILY_LIVE_SESSIONS = parseInt(process.env.MAX_DAILY_LIVE_SESSIONS || '20', 10);

// Returns true and records the attempt if `uid` is still under its daily
// Live session quota; returns false (without recording) if the quota for
// today has already been reached.
export function tryConsumeDailyLiveSession(uid) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = userSessions.get(uid);
  if (!entry || entry.date !== today) {
    userSessions.set(uid, { date: today, count: 1 });
    return true;
  }
  if (entry.count >= MAX_DAILY_LIVE_SESSIONS) {
    return false;
  }
  entry.count += 1;
  return true;
}
