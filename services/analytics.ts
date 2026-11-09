/**
 * First-party product analytics, error reporting and Web Vitals.
 *
 * - Product events are only sent after the explorer opts in (GDPR/ePrivacy).
 * - Error reports are always sent (security/reliability, legitimate interest)
 *   but never include user content or identifiers.
 * - Events are batched and delivered with sendBeacon to /api/events, where the
 *   server writes structured logs (Cloud Logging → BigQuery sink for funnels).
 *
 * Event taxonomy: docs/ANALYTICS.md
 */

import { apiUrl } from './apiOrigin';

type Props = Record<string, string | number | boolean | null | undefined>;
interface QueuedEvent { name: string; props: Props; ts: number; kind: 'event' | 'error' | 'vital' }

const CONSENT_KEY = 'naturegram_analytics_consent';
const ENDPOINT = apiUrl('/api/events');
const queue: QueuedEvent[] = [];
let uid: string | null = null;
let flushTimer: number | null = null;
const sessionId = (() => {
  try { return crypto.randomUUID(); } catch { return String(Math.random()).slice(2); }
})();

export type Consent = 'granted' | 'denied' | null;
export const getConsent = (): Consent => {
  try { return (localStorage.getItem(CONSENT_KEY) as Consent) || null; } catch { return null; }
};
export const setConsent = (c: 'granted' | 'denied') => {
  try { localStorage.setItem(CONSENT_KEY, c); } catch { /* ignore */ }
  if (c === 'granted') {
    track('analytics_consent', { granted: true });
    try { (window as any).ngLoadAdsTag?.(); } catch { /* ignore */ }
  }
  else queue.splice(0, queue.length, ...queue.filter(e => e.kind === 'error'));
};

export const identify = (userId: string | null) => { uid = userId; };

const schedule = () => {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => { flushTimer = null; flush(); }, 8000);
};

export const flush = (useBeacon = false) => {
  if (!queue.length) return;
  const batch = queue.splice(0, 50);
  const consented = getConsent() === 'granted';
  const body = JSON.stringify({
    sessionId,
    uid: consented ? uid : null,
    path: location.pathname,
    events: batch.filter(e => consented || e.kind === 'error'),
  });
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* never let analytics break the app */ }
  if (queue.length) schedule();
};

const clean = (props: Props = {}): Props => {
  const out: Props = {};
  Object.entries(props).slice(0, 20).forEach(([k, v]) => {
    if (v === undefined) return;
    out[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, 120) : v;
  });
  return out;
};

/** Record a product event (dropped unless the explorer opted in). */
export const track = (name: string, props: Props = {}) => {
  if (getConsent() !== 'granted') return;
  queue.push({ name, props: clean(props), ts: Date.now(), kind: 'event' });
  schedule();
};

/** Record an error (no user content: message + location only). */
export const reportError = (message: string, props: Props = {}) => {
  queue.push({ name: 'client_error', props: clean({ message: String(message).slice(0, 200), ...props }), ts: Date.now(), kind: 'error' });
  schedule();
};

let initialised = false;
export const initAnalytics = () => {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;

  window.addEventListener('error', (e) => reportError(e.message || 'error', { source: (e.filename || '').split('/').pop(), line: e.lineno }));
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => reportError((e.reason && (e.reason.message || String(e.reason))) || 'unhandledrejection', { type: 'promise' }));
  window.addEventListener('ng:error', ((e: CustomEvent) => reportError(e.detail?.message || 'render error', { boundary: e.detail?.label })) as EventListener);
  window.addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });

  // Core Web Vitals (no library): LCP, CLS, INP-approximation
  try {
    let lcp = 0, cls = 0, inp = 0;
    new PerformanceObserver(list => { const last = list.getEntries().pop() as any; if (last) lcp = last.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true } as any);
    new PerformanceObserver(list => { list.getEntries().forEach((e: any) => { if (!e.hadRecentInput) cls += e.value; }); }).observe({ type: 'layout-shift', buffered: true } as any);
    new PerformanceObserver(list => { list.getEntries().forEach((e: any) => { inp = Math.max(inp, e.duration || 0); }); }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as any);
    const send = () => {
      if (getConsent() !== 'granted') return;
      queue.push({ name: 'web_vitals', props: { lcp_ms: Math.round(lcp), cls: Math.round(cls * 1000) / 1000, inp_ms: Math.round(inp) }, ts: Date.now(), kind: 'vital' });
      flush(true);
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); }, { once: true });
  } catch { /* PerformanceObserver unsupported */ }

  track('app_open', { standalone: window.matchMedia?.('(display-mode: standalone)').matches || false });
};
