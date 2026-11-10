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

export const DEFAULT_MARK: MarkColors = { ground: '#2d4a22', ground2: '#3e6330', ink: '#ffffff', accent: '#e9b44c' };

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: any, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback);

const SUN_RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const r1 = 116, r2 = 156;
  const p = (r: number) => `${(256 + Math.cos(a) * r).toFixed(1)} ${(256 + Math.sin(a) * r).toFixed(1)}`;
  return `M${p(r1)} L${p(r2)}`;
}).join(' ');

/**
 * The mark as an SVG string (512×512). `shape` 'rounded' for tabs and app icons, 'square' for
 * maskable icons (the OS masks it), 'circle' to match the landing page disc exactly.
 */
export const markSvg = (c: MarkColors, style: Exclude<MarkStyle, 'custom'> = 'sun', shape: 'rounded' | 'square' | 'circle' = 'rounded'): string => {
  const bg = shape === 'circle'
    ? `<circle cx="256" cy="256" r="256" fill="url(#ng)"/>`
    : `<rect width="512" height="512" ${shape === 'rounded' ? 'rx="116"' : ''} fill="url(#ng)"/>`;
  const defs = `<defs><linearGradient id="ng" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${c.ground}"/><stop offset="1" stop-color="${c.ground2}"/></linearGradient></defs>`;
  const art = style === 'lens'
    ? `<g fill="none" stroke="${c.ink}" stroke-linecap="round" stroke-linejoin="round">`
      + `<path stroke-width="22" d="M168 452 C184 386 214 322 262 284 C318 240 330 182 290 162 C252 144 222 176 236 210 C248 238 286 234 290 208 C292 194 282 186 270 190"/>`
      + `<path stroke-width="18" d="M196 380 C168 368 150 346 146 318 M196 380 C226 380 250 368 262 350 M222 326 C200 312 190 294 190 274"/></g>`
      + `<circle cx="266" cy="214" r="112" fill="${c.accent}" fill-opacity="0.14" stroke="${c.accent}" stroke-width="30"/>`
      + `<path d="M347 295 L414 362" stroke="${c.accent}" stroke-width="44" stroke-linecap="round"/>`
    // The landing page's sun: a full disc with eight rounded rays
    : `<circle cx="256" cy="256" r="78" fill="${c.ink}"/>`
      + `<path d="${SUN_RAYS}" stroke="${c.ink}" stroke-width="30" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${bg}${art}</svg>`;
};

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const setLink = (rel: string, href: string, type?: string) => {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"][data-ng-mark]`)
    || document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  el.setAttribute('data-ng-mark', '');
  if (type) el.type = type; else el.removeAttribute('type');
  el.href = href;
};

const lum = (h: string) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h || '');
  if (!m) return null;
  const c = [m[1], m[2], m[3]].map(x => { const v = parseInt(x, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return 21;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/** Mark colours for a naturalist theme: the landing disc's gradient with a white sun. */
export const markColorsFor = (colors: { primary?: string; primaryGradient?: string; shadow?: string; accent?: string; text?: string } | undefined): MarkColors => {
  const ground = hex(colors?.primary, hex(colors?.shadow, DEFAULT_MARK.ground));
  const ground2 = hex(colors?.primaryGradient, ground);
  const ink = contrast('#ffffff', ground) >= 2.2 ? '#ffffff' : '#1c1917';
  const accent0 = hex(colors?.accent, DEFAULT_MARK.accent);
  const accent = contrast(accent0, ground) >= 2.6 ? accent0 : ink;
  return { ground, ground2, ink, accent };
};

/** Colours after applying the admin's branding choice. */
export const resolveColors = (themeColors: Parameters<typeof markColorsFor>[0], b?: BrandingConfig | null): MarkColors => {
  const base = markColorsFor(themeColors);
  if (b?.colorMode !== 'fixed') return base;
  const ground = hex(b.fixed?.ground, base.ground);
  return { ...base, ground, ground2: hex(b.fixed?.ground2, ground), ink: hex(b.fixed?.ink, base.ink) };
};

export const isSafeIcon = (u: any): u is string => typeof u === 'string' && /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) && u.length <= 210_000;

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
export const onBrandingChange = (fn: (b: BrandingConfig | null) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Called by the theme service whenever the fortnight's colours are applied. */
export const applyThemeMark = (themeColors: Parameters<typeof markColorsFor>[0]) => {
  lastTheme = themeColors;
  applyMark(resolveColors(themeColors, branding), branding);
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
      listeners.forEach(fn => { try { fn(branding); } catch { /* ignore */ } });
    }, () => { /* no access or offline: keep the default mark */ });
  } catch { /* keep the default mark */ }
};
