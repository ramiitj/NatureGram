import React, { useEffect, useState } from 'react';
import { getConsent, setConsent, setAdsConsent, isTeenMode } from '../services/analytics';
import { watchTeen } from '../services/guardian';
import Glyph from './Glyph';

/**
 * One-time, non-blocking choice. Usage statistics and Google's ad measurement are two separate
 * choices: Allow covers only the statistics; ad measurement is a box left unticked. Both can be
 * changed later in You → Settings → Privacy.
 */
const ConsentBanner: React.FC = () => {
  const [visible, setVisible] = useState(() => getConsent() === null);
  const [ads, setAds] = useState(false);
  // Teenage explorers are never asked about analytics or ads: both are simply off
  const [teen, setTeen] = useState(false);
  useEffect(() => watchTeen(s => setTeen(s.teen || isTeenMode())), []);
  if (!visible || teen) return null;
  const choose = (c: 'granted' | 'denied') => {
    setConsent(c);
    setAdsConsent(c === 'granted' && ads ? 'granted' : 'denied');
    setVisible(false);
  };
  return (
    <div role="region" aria-label="Usage statistics choice" className="fixed left-4 right-4 bottom-24 sm:left-auto sm:right-6 sm:max-w-sm z-[90] bg-day-bg rounded-2xl border border-stone-200/80 shadow-[0_18px_44px_-22px_rgba(28,25,23,0.45)] p-5 ng-rise">
      <div className="flex gap-3">
        <Glyph name="feather" size={20} className="text-stone-500 mt-0.5 shrink-0" />
        <p className="text-sm text-stone-700 leading-[1.6]">
          May we count how NatureGram is used (screens, crashes, speed)? Never your photos, location or letters. You can change this in Settings. <a href="/privacy.html" target="_blank" rel="noopener" className="ng-link">Privacy</a>
        </p>
      </div>
      <label className="mt-3 flex items-start gap-3 text-sm text-stone-700 leading-[1.5] cursor-pointer min-h-[44px]">
        <input type="checkbox" checked={ads} onChange={e => setAds(e.target.checked)} className="mt-1 w-5 h-5 accent-stone-900 shrink-0" />
        <span>Also let Google measure our ads</span>
      </label>
      {/* Both answers carry equal weight: same size, same style, side by side */}
      <div className="flex gap-3 mt-3">
        <button onClick={() => choose('granted')} className="ng-button-quiet flex-1 min-h-[44px] text-sm">Allow</button>
        <button onClick={() => choose('denied')} className="ng-button-quiet flex-1 min-h-[44px] text-sm">No thanks</button>
      </div>
    </div>
  );
};

export default ConsentBanner;
