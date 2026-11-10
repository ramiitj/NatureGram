/**
 * Firebase App Check (web): proves to the NatureGram server that AI and publishing calls come
 * from the real app. Switched on only when VITE_APPCHECK_SITE_KEY is set at build time.
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

const env = (import.meta as any).env || {};
const SITE_KEY: string = env.VITE_APPCHECK_SITE_KEY || '';
const PROVIDER: string = env.VITE_APPCHECK_PROVIDER || 'enterprise';
const isNative = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();

export const appCheckEnabled = Boolean(SITE_KEY) && !isNative && typeof window !== 'undefined';

let ready: Promise<any> | null = null;
function instance(): Promise<any> {
  if (!appCheckEnabled) return Promise.resolve(null);
  if (!ready) {
    ready = (async () => {
      if (env.VITE_APPCHECK_DEBUG_TOKEN) (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN;
      const m = await import('firebase/app-check');
      const provider = PROVIDER === 'v3' ? new m.ReCaptchaV3Provider(SITE_KEY) : new m.ReCaptchaEnterpriseProvider(SITE_KEY);
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
if (appCheckEnabled) setTimeout(() => { instance(); }, 2500);
