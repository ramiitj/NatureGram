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

// Teen mode (13 to 17): no product analytics, no vitals, no ads tag, whatever was chosen before.
// Error reports, which carry no identifiers, still go out. Set by services/guardian.ts.
let teenMode = false;
export const setTeenMode = (on: boolean) => {
  teenMode = on;
  if (on) queue.splice(0, queue.length, ...queue.filter(e => e.kind === 'error'));
};
export const isTeenMode = () => teenMode;

export type Consent = 'granted' | 'denied' | null;
export const getConsent = (): Consent => {
  try { return (localStorage.getItem(CONSENT_KEY) as Consent) || null; } catch { return null; }
};
export const setConsent = (c: 'granted' | 'denied') => {
  try { localStorage.setItem(CONSENT_KEY, c); } catch { /* ignore */ }
  if (c === 'granted' && !teenMode) {
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
  const consented = getConsent() === 'granted' && !teenMode;
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
  if (getConsent() !== 'granted' || teenMode) return;
  queue.push({ name, props: clean(props), ts: Date.now(), kind: 'event' });
  schedule();
};

/** This tab's analytics session id (random, not linked to the account). */
export const getSessionId = () => sessionId;

// ---------------------------------------------------------------- optional Sentry forwarding
// Set VITE_SENTRY_DSN at build time to also send errors to Sentry. No SDK: one small POST to the
// envelope endpoint. Only the scrubbed message, the page path (no query) and the release go out;
// never user ids, captions, comments, emails, tokens or URLs with parameters.
const SENTRY_DSN: string = ((import.meta as any).env?.VITE_SENTRY_DSN || '').trim();
const RELEASE: string = ((import.meta as any).env?.VITE_RELEASE || '').trim();
const sentry = (() => {
  try {
    if (!SENTRY_DSN) return null;
    const u = new URL(SENTRY_DSN);
    const projectId = u.pathname.replace(/^\/+|\/+$/g, '').split('/').pop();
    if (u.protocol !== 'https:' || !u.username || !projectId) return null;
    return { key: u.username, url: `https://${u.host}/api/${projectId}/envelope/?sentry_key=${encodeURIComponent(u.username)}&sentry_version=7`, dsn: SENTRY_DSN };
  } catch { return null; }
})();
const sentSentry = new Set<string>();

/** Remove anything that could be personal or user content from an error message. */
export const scrubMessage = (m: string) => String(m || '')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
  .replace(/https?:\/\/[^\s'")]+/g, (u) => { try { const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return '[url]'; } })
  .replace(/(["'“‘])(?:(?!\1).){3,}\1/g, '"…"')
  .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[id]')
  .replace(/\b\d{5,}\b/g, '[n]')
  .slice(0, 300);

const toSentry = (message: string, props: Props) => {
  if (!sentry || sentSentry.size >= 20) return;
  const msg = scrubMessage(message);
  if (sentSentry.has(msg)) return; // once per message per session
  sentSentry.add(msg);
  try {
    const eventId = (crypto.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g, '').padEnd(32, '0').slice(0, 32);
    const tags: Record<string, string> = {};
    for (const k of ['source', 'line', 'type', 'boundary'] as const) if (props[k] != null) tags[k] = String(props[k]).slice(0, 60);
    const event = {
      event_id: eventId, timestamp: Date.now() / 1000, platform: 'javascript', level: 'error',
      logger: 'naturegram', message: { formatted: msg }, release: RELEASE || undefined,
      environment: location.hostname === 'localhost' ? 'development' : 'production',
      request: { url: `${location.origin}${location.pathname}` }, tags,
    };
    const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: sentry.dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
    // text/plain keeps it a simple request (no CORS preflight)
    fetch(sentry.url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => {});
  } catch { /* never let error reporting break the app */ }
};

/** Record an error (no user content: message + location only). */
export const reportError = (message: string, props: Props = {}) => {
  queue.push({ name: 'client_error', props: clean({ message: String(message).slice(0, 200), ...props }), ts: Date.now(), kind: 'error' });
  schedule();
  toSentry(message, props);
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
      if (getConsent() !== 'granted' || teenMode) return;
      queue.push({ name: 'web_vitals', props: { lcp_ms: Math.round(lcp), cls: Math.round(cls * 1000) / 1000, inp_ms: Math.round(inp) }, ts: Date.now(), kind: 'vital' });
      flush(true);
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); }, { once: true });
  } catch { /* PerformanceObserver unsupported */ }

  track('app_open', { standalone: window.matchMedia?.('(display-mode: standalone)').matches || false });
};
