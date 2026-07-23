import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { SUPPORTED_LANGUAGES } from '../i18n/translations';

// Compact language toggle for the app's highest-traffic surfaces (landing
// page hero, desktop sidebar). `variant` swaps the visual treatment for
// use against the landing page's dark hero image vs. the light sidebar.
const LanguageSwitcher: React.FC<{ variant?: 'light' | 'dark'; className?: string }> = ({ variant = 'light', className = '' }) => {
  const { language, setLanguage, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const current = SUPPORTED_LANGUAGES.find(l => l.code === language) || SUPPORTED_LANGUAGES[0];
  const isDark = variant === 'dark';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        aria-label={t('languageSwitcherLabel')}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-offset-2 ${
          isDark
            ? 'bg-white/10 border-white/20 text-white hover:bg-white/20'
            : 'bg-stone-50 border-theme-primary/10 text-stone-600 hover:bg-stone-100'
        }`}
      >
        <span className="material-symbols-outlined text-sm">language</span>
        <span className="hidden lg:inline">{current.nativeLabel}</span>
      </button>
      {isOpen && (
        <ul
          role="listbox"
          aria-label={t('languageSwitcherLabel')}
          className="absolute right-0 mt-2 w-40 bg-white rounded-2xl shadow-2xl border border-theme-primary/10 overflow-hidden z-50 py-1"
        >
          {SUPPORTED_LANGUAGES.map(l => (
            <li key={l.code} role="option" aria-selected={l.code === language}>
              <button
                type="button"
                onClick={() => { setLanguage(l.code); setIsOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent focus-visible:ring-inset ${
                  l.code === language ? 'bg-theme-accent/10 text-theme-primary font-bold' : 'text-stone-700 hover:bg-stone-50'
                }`}
              >
                {l.nativeLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LanguageSwitcher;
