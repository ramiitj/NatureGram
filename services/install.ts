/**
 * Putting NatureGram on the home screen, straight from the browser (no app store).
 *
 * - Chrome, Edge and Samsung Internet on Android (and desktop Chrome) offer a one-tap install:
 *   we keep the browser's install event and fire it from our own button.
 * - Safari on iPhone and iPad has no install button for websites: we show the two taps
 *   (Share, then "Add to Home Screen").
 * - In-app browsers (Instagram, Facebook, LinkedIn…) can't install at all: we suggest opening
 *   the link in the phone's browser.
 */

type Platform = 'prompt' | 'ios' | 'in-app' | 'none';

let deferred: any = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault(); // we offer it at a better moment, from our own card
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    try { localStorage.setItem('ng_installed', '1'); } catch { /* private mode */ }
    notify();
  });
}

export const isInstalled = (): boolean => {
  if (typeof window === 'undefined') return false;
  if ((window as any).Capacitor?.isNativePlatform?.()) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
};

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');
export const isInAppBrowser = () => /FBAN|FBAV|Instagram|LinkedInApp|Line\/|Twitter|Snapchat|; wv\)/i.test(ua());
const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);

export const installPlatform = (): Platform => {
  if (isInstalled()) return 'none';
  if (isInAppBrowser()) return 'in-app';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  return 'none';
};

/** Shows the browser's own install dialog. Resolves true if the explorer accepted. */
export const promptInstall = async (): Promise<boolean> => {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  notify();
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  return choice?.outcome === 'accepted';
};

export const onInstallChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Ask to open the install card from anywhere (for example from Settings). */
export const openInstallCard = () => window.dispatchEvent(new Event('ng-open-install'));
