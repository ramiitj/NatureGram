import React, { useEffect, useState } from 'react';
import Glyph from './Glyph';
import { installPlatform, onInstallChange, promptInstall } from '../services/install';
import { getConsent, isTeenMode, track } from '../services/analytics';

const DISMISS_KEY = 'ng_install_dismissed_at';
const VISITS_KEY = 'ng_visits';
const QUIET_DAYS = 14;

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// Count visits once per page load
const visits = (() => {
  const n = Number(store.get(VISITS_KEY) || 0) + 1;
  store.set(VISITS_KEY, String(n));
  return n;
})();

/**
 * A quiet invitation to keep NatureGram on the home screen. It appears on a second visit, or
 * after a minute of exploring on the first, never over the consent choice, and rests for two
 * weeks if dismissed. Settings can open it at any time.
 */
const InstallCard: React.FC = () => {
  const [platform, setPlatform] = useState(installPlatform);
  const [open, setOpen] = useState(false);
  const [forced, setForced] = useState(false);

  useEffect(() => onInstallChange(() => setPlatform(installPlatform())), []);

  useEffect(() => {
    const show = () => { setPlatform(installPlatform()); setForced(true); setOpen(true); };
    window.addEventListener('ng-open-install', show);
    return () => window.removeEventListener('ng-open-install', show);
  }, []);

  useEffect(() => {
    if (platform === 'none' || open) return;
    const last = Number(store.get(DISMISS_KEY) || 0);
    if (Date.now() - last < QUIET_DAYS * 86_400_000) return;
    const wait = visits >= 2 ? 8_000 : 60_000;
    const t = window.setTimeout(() => {
      if (getConsent() === null && !isTeenMode()) return; // let the consent choice come first
      setOpen(true);
      track('install_card_shown', { platform });
    }, wait);
    return () => window.clearTimeout(t);
  }, [platform, open]);

  if (!open || (platform === 'none' && !forced)) return null;

  const dismiss = () => { store.set(DISMISS_KEY, String(Date.now())); setOpen(false); setForced(false); };
  const install = async () => {
    const ok = await promptInstall();
    track('install_prompt', { accepted: ok });
    setOpen(false);
  };

  return (
    <div role="dialog" aria-label="Add NatureGram to your home screen" className="fixed left-4 right-4 bottom-24 sm:left-auto sm:right-6 sm:max-w-sm z-[90] bg-day-bg rounded-2xl border border-stone-200/80 shadow-[0_18px_44px_-22px_rgba(28,25,23,0.45)] p-5 ng-rise">
      <div className="flex gap-3.5">
        <img src="/brand/icon-192.png" onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/icon-192.png'; }} alt="" width={44} height={44} className="w-11 h-11 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-900">Keep NatureGram close</p>
          {platform === 'prompt' && <p className="text-sm text-stone-700 leading-[1.6] mt-0.5">Add it to your home screen and open it like any app, straight into the field.</p>}
          {platform === 'ios' && (
            <ol className="text-sm text-stone-700 leading-[1.7] mt-1 space-y-1">
              <li>1. Tap <span className="font-semibold">Share</span> <Glyph name="share" size={16} className="text-stone-800 inline-block align-[-2px]" /> in the browser's toolbar</li>
              <li>2. Choose <span className="font-semibold">Add to Home Screen</span></li>
            </ol>
          )}
          {platform === 'in-app' && <p className="text-sm text-stone-700 leading-[1.6] mt-0.5">Open NatureGram in your phone's browser (Chrome or Safari) from the ⋯ menu, then add it to your home screen from there.</p>}
          {platform === 'none' && <p className="text-sm text-stone-700 leading-[1.6] mt-0.5">In your browser's menu, choose <span className="font-semibold">Install app</span> or <span className="font-semibold">Add to Home Screen</span>. If NatureGram is already on your home screen, open it from there.</p>}
        </div>
        <button onClick={dismiss} aria-label="Not now" className="w-11 h-11 -mt-2 -mr-2 rounded-full flex items-center justify-center text-stone-500 hover:bg-stone-100 shrink-0"><Glyph name="close" size={18} /></button>
      </div>
      {platform === 'prompt' && (
        <div className="flex gap-3 mt-4">
          <button onClick={install} className="ng-button-quiet flex-1 min-h-[44px] text-sm font-semibold">Add to home screen</button>
          <button onClick={dismiss} className="ng-button-quiet flex-1 min-h-[44px] text-sm">Not now</button>
        </div>
      )}
    </div>
  );
};

export default InstallCard;
