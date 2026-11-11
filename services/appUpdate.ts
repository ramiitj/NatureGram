/**
 * Keeping every open NatureGram current after a new release.
 *
 * A fresh launch always gets the new version (the page itself is fetched from the network). But an
 * app left open, a browser tab or a home-screen app resumed from the background, can run old code
 * for days. So the app checks /version.json, which every build publishes, whenever it comes back
 * to the screen and every 15 minutes, and also asks the service worker to fetch its new copy.
 *
 * When a newer build is out:
 *  - if the explorer is not in the middle of anything (see `isSafe`), the app reloads at once, at a
 *    moment that already feels like a restart (returning to it after a while, or right away when idle);
 *  - otherwise it waits, and offers a quiet "Refresh" the explorer can take when ready.
 * It never reloads in the Lens, during review, while typing, or with a window open.
 */

declare const __BUILD_ID__: string;

const CURRENT = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const CHECK_EVERY_MS = 15 * 60_000;

let latest: string | null = null;
let checking = false;

/** The build the server is serving now, or null when unknown (offline, dev server). */
async function serverBuild(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.build === 'string' ? j.build : null;
  } catch { return null; }
}

export const isUpdateReady = () => !!latest && latest !== CURRENT && CURRENT !== 'dev';

export function startUpdateWatch(opts: {
  /** True when reloading now loses nothing and interrupts nothing */
  isSafe: () => boolean;
  /** A newer build is out but now isn't a good moment: offer a Refresh */
  onReady: () => void;
}) {
  if (typeof window === 'undefined' || CURRENT === 'dev') return () => {};
  let hiddenAt = 0;
  // Never pull the page from under someone scrolling or reading: reload only after a quiet spell
  let lastActive = Date.now();
  const touch = () => { lastActive = Date.now(); };
  const ACTIVITY: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
  ACTIVITY.forEach(ev => window.addEventListener(ev, touch, { passive: true, capture: true }));

  const check = async (reason: 'resume' | 'timer' | 'focus') => {
    if (checking || navigator.onLine === false) return;
    checking = true;
    try {
      // The service worker fetches its own new copy too, so the next launch is current offline as well
      navigator.serviceWorker?.getRegistration?.().then(r => r?.update()).catch(() => {});
      const b = await serverBuild();
      if (!b) return;
      latest = b;
      if (b === CURRENT) return;
      // Coming back after a while feels like a fresh start: update then, if nothing would be lost
      // Each new build is tried once on its own: if a reload still brought the old one (a stale copy
      // somewhere on the way), never loop; offer the Refresh instead
      let tried = '';
      try { tried = sessionStorage.getItem('ng_update_tried') || ''; } catch { /* ignore */ }
      if (tried === b) { opts.onReady(); return; }
      if (opts.isSafe() && (reason === 'resume' || (document.visibilityState === 'visible' && Date.now() - lastActive > 120_000))) {
        try { sessionStorage.setItem('ng_update_tried', b); } catch { /* ignore */ }
        reloadNow();
        return;
      }
      opts.onReady();
    } finally { checking = false; }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    // Back on screen: check (a quick glance away and back doesn't need a reload unless an update waits)
    check(hiddenAt && Date.now() - hiddenAt > 30_000 ? 'resume' : 'focus');
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onFocus = () => check('focus');
  window.addEventListener('focus', onFocus);
  const timer = window.setInterval(() => check('timer'), CHECK_EVERY_MS);
  // First look shortly after start (the build may have changed while this copy loaded from cache)
  const first = window.setTimeout(() => check('timer'), 20_000);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    clearInterval(timer); clearTimeout(first);
    ACTIVITY.forEach(ev => window.removeEventListener(ev, touch, { capture: true } as any));
  };
}

/** Reload onto the newest build (the page is network-first, so this always gets it). */
export function reloadNow() {
  try { sessionStorage.setItem('ng_updated_at', String(Date.now())); } catch { /* ignore */ }
  window.location.reload();
}

/** Did this page load come from an update reload? (for a quiet "Updated" note) */
export function justUpdated(): boolean {
  try {
    const t = Number(sessionStorage.getItem('ng_updated_at') || 0);
    if (!t) return false;
    sessionStorage.removeItem('ng_updated_at');
    return Date.now() - t < 60_000;
  } catch { return false; }
}
