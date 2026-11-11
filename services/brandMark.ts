/**
 * The NatureGram mark. By default it is the landing page's sun: a white sun on a disc in the
 * gradient of the naturalist of the fortnight, so the browser tab and home-screen icon change
 * colour with the theme every fifteen days. An admin can change it (Admin → Branding), which is
 * stored in config/branding (public read, admin write through the admin API):
 *
 *   style      'sun' (default) | 'lens' (a hand lens over a fiddlehead) | 'custom' (an uploaded PNG)
 *   colorMode  'naturalist' (default: follow the fortnight) | 'fixed' (use `fixed` colours)
 *   fixed      { ground, ground2, ink }  hex colours used when colorMode is 'fixed'
 *   customIcon data:image/png or data:image/webp URL (≤ 150 KB), used when style is 'custom'
 */

export type MarkStyle = 'sun' | 'lens' | 'custom';

export interface MarkColors {
  /** Gradient start (deep theme colour) */
  ground: string;
  /** Gradient end */
  ground2: string;
  /** The sun / drawing (light ink) */
  ink: string;
  /** Second colour for the lens style (theme accent) */
  accent: string;
}

export interface BrandingConfig {
  style?: MarkStyle;
  colorMode?: 'naturalist' | 'fixed';
  fixed?: { ground?: string; ground2?: string; ink?: string };
  customIcon?: string | null;
}

import { DEFAULT_MARK as CORE_DEFAULT, markSvg as coreMarkSvg, markColorsFor as coreColorsFor, resolveColors as coreResolve, isSafeIcon as coreSafe } from '../shared/brandMarkCore.js';

export const DEFAULT_MARK: MarkColors = CORE_DEFAULT;
/**
 * The mark as an SVG string (512×512). `shape` 'rounded' for tabs and app icons, 'square' for
 * maskable icons (the OS masks it), 'circle' to match the landing page disc exactly.
 */
export const markSvg = (c: MarkColors, style: Exclude<MarkStyle, 'custom'> = 'sun', shape: 'rounded' | 'square' | 'circle' = 'rounded'): string => coreMarkSvg(c, style, shape);
type ThemeColors = { primary?: string; primaryGradient?: string; shadow?: string; accent?: string; text?: string } | undefined;
/** Mark colours for a naturalist theme: the landing disc's gradient with a white sun. */
export const markColorsFor = (colors: ThemeColors): MarkColors => coreColorsFor(colors);
/** Colours after applying the admin's branding choice. */
export const resolveColors = (themeColors: ThemeColors, b?: BrandingConfig | null): MarkColors => coreResolve(themeColors, b);
export const isSafeIcon = (u: any): u is string => coreSafe(u);

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const setLink = (rel: string, href: string, type?: string) => {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"][data-ng-mark]`)
    || document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  el.setAttribute('data-ng-mark', '');
  if (type) el.type = type; else el.removeAttribute('type');
  el.href = href;
};

/** Point the favicon and the iOS home-screen icon at the current mark. */
export const applyMark = (c: MarkColors, b?: BrandingConfig | null) => {
  if (typeof document === 'undefined') return;
  try {
    if (b?.style === 'custom' && isSafeIcon(b.customIcon)) {
      setLink('icon', b.customIcon);
      setLink('apple-touch-icon', b.customIcon);
      return;
    }
    const style = b?.style === 'lens' ? 'lens' : 'sun';
    setLink('icon', svgUrl(markSvg(c, style)), 'image/svg+xml');
    // Safari and the iOS home screen want a PNG
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = cv.height = 180;
        const ctx = cv.getContext('2d'); if (!ctx) return;
        ctx.drawImage(img, 0, 0, 180, 180);
        setLink('apple-touch-icon', cv.toDataURL('image/png'));
      } catch { /* keep the static icon */ }
    };
    img.src = svgUrl(markSvg(c, style, 'square'));
  } catch { /* keep the static icon */ }
};

// ----------------------------------------------------------------- live branding from config/branding
let branding: BrandingConfig | null = null;
let lastTheme: Parameters<typeof markColorsFor>[0] = undefined;
const listeners = new Set<(b: BrandingConfig | null) => void>();

export const currentBranding = () => branding;

/** The mark as shown right now (theme or admin colours, style, custom image), for the app's own logo. */
export interface CurrentMark { colors: MarkColors; style: Exclude<MarkStyle, 'custom'>; custom: string | null }
let current: CurrentMark = { colors: DEFAULT_MARK, style: 'sun', custom: null };
const markListeners = new Set<() => void>();
const publishMark = () => {
  current = {
    colors: resolveColors(lastTheme, branding),
    style: branding?.style === 'lens' ? 'lens' : 'sun',
    custom: branding?.style === 'custom' && isSafeIcon(branding.customIcon) ? branding.customIcon : null,
  };
  markListeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
};
export const getCurrentMark = () => current;
export const subscribeMark = (fn: () => void) => { markListeners.add(fn); return () => { markListeners.delete(fn); }; };
/** The current mark as an image URL (a disc, like the landing sun and the browser tab). */
export const currentMarkUrl = (m: CurrentMark = current) => m.custom || svgUrl(markSvg(m.colors, m.style, 'circle'));
export const onBrandingChange = (fn: (b: BrandingConfig | null) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Called by the theme service whenever the fortnight's colours are applied. */
export const applyThemeMark = (themeColors: Parameters<typeof markColorsFor>[0]) => {
  lastTheme = themeColors;
  applyMark(resolveColors(themeColors, branding), branding);
  publishMark();
};

/** Follow config/branding so an admin's change reaches open apps within seconds. Safe to call once. */
let started = false;
export const startBranding = async () => {
  if (started || typeof window === 'undefined') return;
  started = true;
  try {
    const [{ db }, fs] = await Promise.all([import('../firebaseConfig'), import('firebase/firestore')]);
    fs.onSnapshot(fs.doc(db, 'config', 'branding'), snap => {
      branding = snap.exists() ? (snap.data() as BrandingConfig) : null;
      applyMark(resolveColors(lastTheme, branding), branding);
      publishMark();
      listeners.forEach(fn => { try { fn(branding); } catch { /* ignore */ } });
    }, () => { /* no access or offline: keep the default mark */ });
  } catch { /* keep the default mark */ }
};
