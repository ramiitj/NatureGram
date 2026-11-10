/**
 * Firebase App Check (web): proves to the NatureGram server that AI and publishing calls come
 * from the real app. Switched on when a site key is available: VITE_APPCHECK_SITE_KEY at build
 * time, or APPCHECK_SITE_KEY on the server (read at runtime from /api/client-config, so the key
 * can be set on Cloud Run without rebuilding).
 *
 *   VITE_APPCHECK_SITE_KEY   reCAPTCHA Enterprise site key (or a reCAPTCHA v3 key, see below)
 *   VITE_APPCHECK_PROVIDER   'enterprise' (default) or 'v3'
 *   VITE_APPCHECK_DEBUG_TOKEN  for local development only (registered in the Firebase console)
 *
 * The SDK is loaded lazily, so builds without a key carry none of it. Native (Capacitor) builds
 * skip it: reCAPTCHA does not run in the app's webview, and App Attest / Play Integrity need
 * native plugins. Every call here fails soft: no token simply means no header.
 */
import { getApp } from 'firebase/app';
import '../firebaseConfig';
import { apiUrl } from './apiOrigin';

const env = (import.meta as any).env || {};
const BUILD_KEY: string = env.VITE_APPCHECK_SITE_KEY || '';
const BUILD_PROVIDER: string = env.VITE_APPCHECK_PROVIDER || 'enterprise';
const isNative = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
const canRun = !isNative && typeof window !== 'undefined';

/** True when a key was baked in at build time (the runtime key is discovered lazily). */
export const appCheckEnabled = Boolean(BUILD_KEY) && canRun;

let keyPromise: Promise<{ key: string; provider: string }> | null = null;
const siteKey = () => {
  if (!keyPromise) {
    keyPromise = BUILD_KEY
      ? Promise.resolve({ key: BUILD_KEY, provider: BUILD_PROVIDER })
      : fetch(apiUrl('/api/client-config')).then(r => r.ok ? r.json() : {}).then((c: any) => ({ key: String(c?.appCheckSiteKey || ''), provider: c?.appCheckProvider === 'v3' ? 'v3' : 'enterprise' })).catch(() => ({ key: '', provider: 'enterprise' }));
  }
  return keyPromise;
};

let ready: Promise<any> | null = null;
function instance(): Promise<any> {
  if (!canRun) return Promise.resolve(null);
  if (!ready) {
    ready = (async () => {
      const { key, provider: kind } = await siteKey();
      if (!key) return null;
      if (env.VITE_APPCHECK_DEBUG_TOKEN) (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN;
      const m = await import('firebase/app-check');
      const provider = kind === 'v3' ? new m.ReCaptchaV3Provider(key) : new m.ReCaptchaEnterpriseProvider(key);
      return { m, ac: m.initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true }) };
    })().catch(() => null);
  }
  return ready;
}

/** The current App Check token, or null (never throws, never waits more than a few seconds). */
export async function appCheckToken(): Promise<string | null> {
  const inst = await instance();
  if (!inst) return null;
  try {
    const res = await Promise.race([
      inst.m.getToken(inst.ac, false),
      new Promise<null>(r => setTimeout(() => r(null), 4000)),
    ]);
    return (res as any)?.token || null;
  } catch { return null; }
}

/** Headers to add to calls to the NatureGram API ({} when App Check is off or unavailable). */
export async function appCheckHeaders(): Promise<Record<string, string>> {
  const token = await appCheckToken();
  return token ? { 'X-Firebase-AppCheck': token } : {};
}

/** Start App Check early (call once at startup); harmless when it is off. */
export const initAppCheck = () => { instance(); };

// Warm up shortly after start (off the critical path) so the first protected call doesn't wait
if (canRun) setTimeout(() => { instance(); }, 2500);
