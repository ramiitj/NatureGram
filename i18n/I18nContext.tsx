import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { SupportedLanguage, TranslationKey, TRANSLATIONS, SUPPORTED_LANGUAGES } from './translations';

const STORAGE_KEY = 'naturegram_lang';

// Matches the browser's reported languages (navigator.languages, most
// preferred first) against what we actually ship translations for, using
// only the primary subtag ("es-MX" -> "es") since we don't maintain
// per-region variants.
const detectBrowserLanguage = (): SupportedLanguage => {
  const candidates = typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [];
  for (const candidate of candidates) {
    const primary = candidate?.split('-')[0]?.toLowerCase();
    const match = SUPPORTED_LANGUAGES.find(l => l.code === primary);
    if (match) return match.code;
  }
  return 'en';
};

interface I18nContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as SupportedLanguage | null;
      if (stored && SUPPORTED_LANGUAGES.some(l => l.code === stored)) return stored;
    } catch {
      // localStorage unavailable (private browsing, etc.) — fall through to detection.
    }
    return detectBrowserLanguage();
  });

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: SupportedLanguage) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Best-effort persistence only.
    }
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return TRANSLATIONS[language][key] ?? TRANSLATIONS.en[key] ?? key;
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
};
