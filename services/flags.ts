/**
 * Feature flags and A/B experiments.
 *
 * The admin edits `config/flags` (Admin → Experiments); everyone can read it:
 *   { flags: { [name]: { enabled: boolean, rollout: 0..100, variants?: [{ name, weight }], description? } } }
 *
 * Each explorer lands in a stable bucket: a hash of the flag name and their account id (or, when
 * signed out, a random id kept on this device). The same explorer always sees the same variant,
 * on every device they sign in on, without anything being stored about them.
 *
 * Safe defaults: if the document is missing, unreadable or a flag is unknown, the flag is off
 * and the variant is 'control'. The first time a flag is evaluated on screen in a session,
 * an `experiment_exposure` event is recorded (only if the explorer allowed analytics).
 *
 *   const { on, variant } = useFlag('new_explore');
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import { track, getSessionId } from './analytics';

export interface FlagVariant { name: string; weight: number }
export interface FlagDef { enabled?: boolean; rollout?: number; variants?: FlagVariant[]; description?: string }
export interface FlagResult { on: boolean; variant: string; loading: boolean }

const OFF: FlagResult = { on: false, variant: 'control', loading: false };
let flags: Record<string, FlagDef> = {};
let loaded = false;
let started = false;
const listeners = new Set<() => void>();
const exposed = new Set<string>();

function start() {
  if (started) return;
  started = true;
  try {
    onSnapshot(doc(db, 'config', 'flags'), (snap) => {
      const f = snap.exists() ? (snap.data() as any).flags : null;
      flags = f && typeof f === 'object' ? f : {};
      loaded = true;
      listeners.forEach(l => l());
    }, () => { flags = {}; loaded = true; listeners.forEach(l => l()); });
  } catch { loaded = true; }
}

const DEVICE_KEY = 'ng_ab_id';
function unitId(): string {
  const uid = auth.currentUser?.uid;
  if (uid) return uid;
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = (crypto.randomUUID?.() || String(Math.random()).slice(2)); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return getSessionId(); }
}

/** FNV-1a 32-bit: small, fast and stable across browsers. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Pure evaluation (exported for tests and the admin preview). */
export function evaluateFlag(name: string, def: FlagDef | undefined, unit: string): { on: boolean; variant: string; bucket: number } {
  const bucket = (hash32(`${name}:${unit}`) % 10000) / 100; // 0.00 .. 99.99
  if (!def || def.enabled !== true) return { on: false, variant: 'control', bucket };
  const rollout = Math.max(0, Math.min(100, Number(def.rollout ?? 0)));
  if (bucket >= rollout) return { on: false, variant: 'control', bucket };
  const variants = (def.variants || []).filter(v => v && v.name && v.weight > 0);
  if (!variants.length) return { on: true, variant: 'on', bucket };
  const total = variants.reduce((a, v) => a + v.weight, 0);
  let pick = hash32(`${name}:variant:${unit}`) % total;
  for (const v of variants) { if (pick < v.weight) return { on: true, variant: v.name, bucket }; pick -= v.weight; }
  return { on: true, variant: variants[variants.length - 1].name, bucket };
}

/** Current value of a flag, without React. Records exposure once per session. */
export function getFlag(name: string, { expose = true } = {}): FlagResult {
  start();
  if (!loaded) return { ...OFF, loading: true };
  const def = flags[name];
  const r = evaluateFlag(name, def, unitId());
  if (expose && def && def.enabled === true) {
    const key = `${name}:${r.variant}`;
    if (!exposed.has(key)) {
      exposed.add(key);
      track('experiment_exposure', { flag: name, variant: r.variant, on: r.on });
    }
  }
  return { on: r.on, variant: r.variant, loading: false };
}

/** React hook: re-renders when the admin changes the flag. */
export function useFlag(name: string): FlagResult {
  const [, bump] = useState(0);
  useEffect(() => {
    start();
    const l = () => bump(n => n + 1);
    listeners.add(l);
    const unsub = auth.onAuthStateChanged(() => l()); // a sign-in can move the explorer to their account's bucket
    return () => { listeners.delete(l); unsub(); };
  }, [name]);
  return getFlag(name);
}
