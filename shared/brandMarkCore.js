/**
 * The NatureGram mark, shared by the app (services/brandMark.ts) and the server (home-screen
 * icons and the web app manifest), so the installed icon matches the one in the browser tab.
 * Plain JavaScript so the server can import it without a build step.
 */

export const DEFAULT_MARK = { ground: '#2d4a22', ground2: '#3e6330', ink: '#ffffff', accent: '#e9b44c' };

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v : fallback);

const SUN_RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const r1 = 116, r2 = 156;
  const p = (r) => `${(256 + Math.cos(a) * r).toFixed(1)} ${(256 + Math.sin(a) * r).toFixed(1)}`;
  return `M${p(r1)} L${p(r2)}`;
}).join(' ');

/**
 * The mark as an SVG string (512×512). `shape` 'rounded' for tabs and app icons, 'square' for
 * maskable icons (the OS masks it), 'circle' to match the landing page disc exactly.
 */
export const markSvg = (c, style = 'sun', shape = 'rounded') => {
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

const lum = (h) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h || '');
  if (!m) return null;
  const c = [m[1], m[2], m[3]].map(x => { const v = parseInt(x, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return 21;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/** Mark colours for a naturalist theme: the landing disc's gradient with a white sun. */
export const markColorsFor = (colors) => {
  const ground = hex(colors?.primary, hex(colors?.shadow, DEFAULT_MARK.ground));
  const ground2 = hex(colors?.primaryGradient, ground);
  const ink = contrast('#ffffff', ground) >= 2.2 ? '#ffffff' : '#1c1917';
  const accent0 = hex(colors?.accent, DEFAULT_MARK.accent);
  const accent = contrast(accent0, ground) >= 2.6 ? accent0 : ink;
  return { ground, ground2, ink, accent };
};

/** Colours after applying the admin's branding choice. */
export const resolveColors = (themeColors, b) => {
  const base = markColorsFor(themeColors);
  if (b?.colorMode !== 'fixed') return base;
  const ground = hex(b.fixed?.ground, base.ground);
  return { ...base, ground, ground2: hex(b.fixed?.ground2, ground), ink: hex(b.fixed?.ink, base.ink) };
};

export const isSafeIcon = (u) => typeof u === 'string' && /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) && u.length <= 210_000;

