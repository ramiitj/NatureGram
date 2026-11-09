import React, { useState } from 'react';
import { getConsent, setConsent } from '../services/analytics';

/** One-time, non-blocking choice about anonymous usage statistics. */
const ConsentBanner: React.FC = () => {
  const [visible, setVisible] = useState(() => getConsent() === null);
  if (!visible) return null;
  const choose = (c: 'granted' | 'denied') => { setConsent(c); setVisible(false); };
  return (
    <div role="region" aria-label="Usage statistics choice" className="fixed left-3 right-3 bottom-24 sm:left-auto sm:right-4 sm:max-w-sm z-[90] bg-white rounded-2xl shadow-2xl border border-stone-200 p-4 animate-slide-up">
      <p className="text-sm text-stone-800 leading-relaxed">
        Help us improve NatureGram? We'd like to collect usage statistics (screens used, crashes, speed). Never your photos, location or messages. <a href="/privacy.html" target="_blank" rel="noopener" className="underline">Privacy</a>
      </p>
      <div className="flex gap-2 mt-3">
        <button onClick={() => choose('granted')} className="flex-1 py-2.5 rounded-xl bg-theme-primary text-white text-sm font-bold">Allow</button>
        <button onClick={() => choose('denied')} className="flex-1 py-2.5 rounded-xl border border-theme-primary/15 text-theme-primary text-sm font-bold">No thanks</button>
      </div>
    </div>
  );
};

export default ConsentBanner;
