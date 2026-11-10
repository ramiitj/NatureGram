import React, { useState } from 'react';
import { getConsent, setConsent } from '../services/analytics';
import Glyph from './Glyph';

/** One-time, non-blocking choice about anonymous usage statistics. */
const ConsentBanner: React.FC = () => {
  const [visible, setVisible] = useState(() => getConsent() === null);
  if (!visible) return null;
  const choose = (c: 'granted' | 'denied') => { setConsent(c); setVisible(false); };
  return (
    <div role="region" aria-label="Usage statistics choice" className="fixed left-3 right-3 bottom-24 sm:left-auto sm:right-4 sm:max-w-sm z-[90] bg-[#fcfaf8] rounded-2xl shadow-[0_2px_4px_rgba(60,40,20,0.08),0_18px_40px_-12px_rgba(60,40,20,0.35)] border border-[#e8dfcd] p-4 animate-slide-up">
      <div className="flex gap-3">
        <Glyph name="feather" size={22} className="text-theme-accent mt-0.5" />
        <p className="text-sm text-stone-800 leading-relaxed">
          May we learn how NatureGram is used? With your OK we collect usage statistics (screens used, crashes, speed) and let Google measure our ads. Never your photos, location or messages. <a href="/privacy.html" target="_blank" rel="noopener" className="underline underline-offset-2 text-theme-accent font-medium">Privacy</a>
        </p>
      </div>
      {/* Both answers carry equal weight: same size, same style, side by side */}
      <div className="flex gap-2 mt-3">
        <button onClick={() => choose('granted')} className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-theme-primary/40 bg-white text-theme-primary text-sm font-semibold hover:bg-stone-50">Allow</button>
        <button onClick={() => choose('denied')} className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-theme-primary/40 bg-white text-theme-primary text-sm font-semibold hover:bg-stone-50">No thanks</button>
      </div>
    </div>
  );
};

export default ConsentBanner;
