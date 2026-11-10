/**
 * Teen mode with a parent's consent, on the phone's side.
 *
 * - teenStateOf(profile): what applies to an explorer right now (the server and the rules decide
 *   the same thing independently; this only shapes what the app offers).
 * - watchTeen(): one shared subscription to the signed-in explorer's profile, so the banner, the
 *   consent banner and analytics all agree, and analytics goes quiet for teens.
 * - The /api/guardian calls (server/guardian.js).
 */
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { apiUrl } from './apiOrigin';
import { setTeenMode } from './analytics';
import type { UserProfileData } from '../types';

export type GuardianStatus = 'none' | 'pending' | 'approved' | 'declined' | 'withdrawn';
export interface TeenState { teen: boolean; status: GuardianStatus; approved: boolean; uid: string | null; username: string; guardianOf: string[] }

const toMs = (t: any): number => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : typeof t === 'number' ? t : 0);

/** The first day of the month someone born in that month and year turns 18 (UTC). */
export const adultFromOf = (month: number, year: number) => Timestamp.fromMillis(Date.UTC(year + 18, month - 1, 1));

export const isTeenProfile = (p?: Partial<UserProfileData> | null, now = Date.now()) =>
  !!p && p.ageBand === 'teen' && !(toMs(p.adultFrom) && toMs(p.adultFrom) <= now);

export const teenStateOf = (p: Partial<UserProfileData> | null | undefined, uid: string | null = null): TeenState => {
  const teen = isTeenProfile(p);
  const status = (teen ? (p?.guardian?.status || 'none') : 'none') as GuardianStatus;
  return { teen, status, approved: teen && status === 'approved', uid, username: p?.username || '', guardianOf: Array.isArray(p?.guardianOf) ? p!.guardianOf! : [] };
};

// ---------------------------------------------------------------- shared watch
const ADULT: TeenState = { teen: false, status: 'none', approved: false, uid: null, username: '', guardianOf: [] };
let current: TeenState = ADULT;
const listeners = new Set<(s: TeenState) => void>();
let started = false;
const TEEN_DEVICE_KEY = 'naturegram_teen';

const teenDevice = () => { try { return localStorage.getItem(TEEN_DEVICE_KEY) === '1'; } catch { return false; } };

const publish = (s: TeenState) => {
  current = s;
  // Signed out on a teen's device: stay quiet until an adult signs in
  setTeenMode(s.teen || (!s.uid && teenDevice()));
  try {
    // gtag-init.js reads this before anything loads, so a teen's device never loads the ads tag
    if (s.teen) localStorage.setItem(TEEN_DEVICE_KEY, '1');
    else if (s.uid) localStorage.removeItem(TEEN_DEVICE_KEY);
  } catch { /* storage unavailable */ }
  if (s.teen) {
    try { (window as any).gtag?.('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }); } catch { /* ignore */ }
  }
  listeners.forEach(l => l(s));
};

const start = () => {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (teenDevice()) setTeenMode(true);
  let unsubProfile: (() => void) | null = null;
  onAuthStateChanged(auth, (user) => {
    unsubProfile?.(); unsubProfile = null;
    if (!user || user.isAnonymous) { publish({ ...ADULT }); return; }
    unsubProfile = onSnapshot(doc(db, 'users', user.uid), snap => publish(teenStateOf(snap.exists() ? (snap.data() as UserProfileData) : null, user.uid)), () => {});
  });
};

export const getTeenState = () => current;
export const watchTeen = (cb: (s: TeenState) => void) => { start(); listeners.add(cb); cb(current); return () => { listeners.delete(cb); }; };

// ---------------------------------------------------------------- API
export interface ApiResult<T = any> { ok: boolean; code?: string; message?: string; status?: number; data?: T }

const call = async <T = any>(method: 'GET' | 'POST', path: string, body?: any, withAuth = true): Promise<ApiResult<T>> => {
  try {
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (withAuth) {
      const token = await auth.currentUser?.getIdToken(true).catch(() => auth.currentUser?.getIdToken());
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(apiUrl(path), { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, status: res.status, data: json } : { ok: false, status: res.status, code: json.code, message: json.message || 'Something went wrong. Please try again.', data: json };
  } catch {
    return { ok: false, code: 'offline', message: 'We can\'t reach NatureGram just now. Check your connection and try again.' };
  }
};

export interface RequestSent { sent: boolean; to: string; link?: string; expiresAt: number }
export interface GuardianFacts { what: string; collected: string[]; notCollected: string[]; teenMode: string[]; controls: string[] }
export interface GuardianSummary { teen: { username: string; firstName: string | null; avatarUrl: string | null }; expiresAt: number; facts: GuardianFacts }

/** Ask a parent (or ask again, or ask a different address). Leave the email out to resend. */
export const requestGuardian = (parentEmail?: string) => call<RequestSent>('POST', '/api/guardian/request', { parentEmail: parentEmail || '' });
export const guardianSummary = (t: string) => call<GuardianSummary>('GET', `/api/guardian/request?t=${encodeURIComponent(t)}`, undefined, false);
export const approveGuardian = (t: string, confirmAdult: boolean, confirmGuardian: boolean) => call<{ teen: { uid: string; username: string } }>('POST', '/api/guardian/approve', { t, confirmAdult, confirmGuardian });
export const declineGuardian = (t: string) => call('POST', '/api/guardian/decline', { t });
export const withdrawGuardian = (teenUid: string) => call('POST', '/api/guardian/withdraw', { teenUid });
export const deleteChildAccount = (teenUid: string) => call('POST', '/api/guardian/delete', { teenUid, confirm: true });

/** Hand the parent's link on with the phone's share sheet, or copy it. Resolves how it went. */
export const shareGuardianLink = async (link: string, teenName: string): Promise<'shared' | 'copied' | 'failed'> => {
  const text = `I'd like to use NatureGram, a field notebook for nature. Because I'm under 18 it needs your OK. It takes about two minutes:`;
  try {
    if (navigator.share) { await navigator.share({ title: `${teenName || 'Your explorer'} would like to explore NatureGram`, text, url: link }); return 'shared'; }
  } catch (e: any) { if (e?.name === 'AbortError') return 'failed'; }
  try { await navigator.clipboard.writeText(`${text} ${link}`); return 'copied'; } catch { return 'failed'; }
};
