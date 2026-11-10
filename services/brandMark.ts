/**
 * The NatureGram mark: a hand lens held over a fern frond. It says what the app is for, looking
 * closely at living things, and it is drawn from the colours of the naturalist of the fortnight,
 * so the browser tab and home-screen icon change with the theme every fifteen days.
 */

export interface MarkColors {
  /** Card background (deep theme colour) */
  ground: string;
  /** The lens rim and handle (theme accent) */
  lens: string;
  /** The frond (light ink) */
  frond: string;
}

/** The mark as an SVG string (512×512). `rounded` gives the card corners; off for maskable icons. */
export const markSvg = (c: MarkColors, rounded = true): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`
  + `<rect width="512" height="512" ${rounded ? 'rx="116"' : ''} fill="${c.ground}"/>`
  // A fiddlehead: a young fern frond uncurling, seen through the lens
  + `<g fill="none" stroke="${c.frond}" stroke-linecap="round" stroke-linejoin="round">`
  + `<path stroke-width="22" d="M168 452 C184 386 214 322 262 284 C318 240 330 182 290 162 C252 144 222 176 236 210 C248 238 286 234 290 208 C292 194 282 186 270 190"/>`
  + `<path stroke-width="18" d="M196 380 C168 368 150 346 146 318 M196 380 C226 380 250 368 262 350 M222 326 C200 312 190 294 190 274"/>`
  + `</g>`
  + `<circle cx="266" cy="214" r="112" fill="${c.lens}" fill-opacity="0.14" stroke="${c.lens}" stroke-width="30"/>`
  + `<path d="M347 295 L414 362" stroke="${c.lens}" stroke-width="44" stroke-linecap="round"/>`
  + `</svg>`;

export const DEFAULT_MARK: MarkColors = { ground: '#2d4a22', lens: '#e9b44c', frond: '#f3efe2' };

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const setLink = (rel: string, href: string, type?: string) => {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"][data-ng-mark]`)
    || document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  el.setAttribute('data-ng-mark', '');
  if (type) el.type = type;
  el.href = href;
};

/** Point the favicon (and the iOS home-screen icon) at the mark in this fortnight's colours. */
export const applyMark = (c: MarkColors) => {
  if (typeof document === 'undefined') return;
  try {
    const svg = markSvg(c);
    setLink('icon', svgUrl(svg), 'image/svg+xml');
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
    img.src = svgUrl(markSvg(c, false));
  } catch { /* keep the static icon */ }
};

const lum = (hex: string) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return null;
  const c = [m[1], m[2], m[3]].map(h => { const v = parseInt(h, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return 21;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/** Mark colours for a naturalist theme: deep ground, accent lens, light frond (kept legible at 16 px). */
export const markColorsFor = (colors: { primary?: string; shadow?: string; accent?: string; primaryGradient?: string; text?: string } | undefined): MarkColors => {
  const ground = colors?.primary || colors?.shadow || DEFAULT_MARK.ground;
  const frond = colors?.text && contrast(colors.text, ground) >= 3 ? colors.text : DEFAULT_MARK.frond;
  const accent = colors?.accent || colors?.primaryGradient || DEFAULT_MARK.lens;
  const lens = contrast(accent, ground) >= 2.6 ? accent : (contrast(DEFAULT_MARK.lens, ground) >= 2.6 ? DEFAULT_MARK.lens : frond);
  return { ground, lens, frond };
};
