/**
 * Home-screen icons and the web app manifest, drawn on the server from the same mark the app
 * shows in the browser tab: the fortnight's naturalist colours, or the admin's branding choice
 * (config/branding). The icon URLs carry a version made from the mark itself, so when the mark
 * changes the manifest points at new URLs and Chrome on Android offers the new icon.
 *
 *  GET /manifest.json, /manifest.webmanifest   the manifest, with versioned icon URLs
 *  GET /brand/:name.png                         icon-192, icon-512, maskable-512, apple-touch-icon
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';
import { markSvg, resolveColors, isSafeIcon } from '../shared/brandMarkCore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROTATION = JSON.parse(fs.readFileSync(path.join(here, '../constants/palettes.json'), 'utf8'));
// The rotation follows local dates; NatureGram's explorers are mostly in India
const TZ_OFFSET_MIN = Number(process.env.ROTATION_TZ_OFFSET_MIN ?? 330);

/** The naturalist of a moment, matching constants/naturalists.ts rotationAt(). */
export function naturalistAt(when = Date.now()) {
  const local = new Date(when + TZ_OFFSET_MIN * 60_000);
  const y = local.getUTCFullYear();
  const dayOfYear = Math.floor((Date.UTC(y, local.getUTCMonth(), local.getUTCDate()) - Date.UTC(y, 0, 0)) / 86_400_000);
  const slot = Math.floor(dayOfYear / ROTATION.periodDays);
  const [cy, cm, cd] = String(ROTATION.cutover).split('-').map(Number);
  const afterCutover = Date.UTC(y, local.getUTCMonth(), local.getUTCDate()) >= Date.UTC(cy, cm - 1, cd);
  const order = afterCutover ? ROTATION.order : ROTATION.legacyOrder;
  return order[slot % order.length];
}

const themeColorsOf = (id) => {
  const p = ROTATION.palettes[id] || {};
  return { primary: p.primary, primaryGradient: p.gradient, shadow: p.deep, accent: p.accent, text: p.text };
};

const SIZES = {
  'icon-192': { size: 192, shape: 'square' },
  'icon-512': { size: 512, shape: 'square' },
  'maskable-512': { size: 512, shape: 'square' },
  'apple-touch-icon': { size: 180, shape: 'square' },
};

export function mountBrandIcons(app, { db, log }) {
  let cache = { at: 0, mark: null };
  const pngs = new Map(); // `${version}:${name}` -> Buffer

  /** The current mark: colours, style, custom image and a version string. */
  async function currentMark() {
    if (cache.mark && Date.now() - cache.at < 5 * 60_000) return cache.mark;
    const id = naturalistAt();
    let themeColors = themeColorsOf(id);
    let branding = null;
    const store = db();
    if (store) {
      try {
        const [theme, brand] = await Promise.race([
          Promise.all([store.doc(`themes/${id}`).get(), store.doc('config/branding').get()]),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
        ]);
        const t = theme.exists ? theme.data() : null;
        if (t?.colorsOverride === true && t.colors) themeColors = { ...themeColors, ...t.colors };
        branding = brand.exists ? brand.data() : null;
      } catch (e) { log('warn', 'brand mark: store unavailable, using the palette', { error: String(e.message).slice(0, 120) }); }
    }
    const style = branding?.style === 'custom' && isSafeIcon(branding.customIcon) ? 'custom' : branding?.style === 'lens' ? 'lens' : 'sun';
    const colors = resolveColors(themeColors, branding);
    const custom = style === 'custom' ? branding.customIcon : null;
    const version = crypto.createHash('sha1').update(JSON.stringify({ style, colors, custom: custom ? crypto.createHash('sha1').update(custom).digest('hex') : null })).digest('hex').slice(0, 10);
    cache = { at: Date.now(), mark: { style, colors, custom, version, naturalist: id } };
    return cache.mark;
  }

  function render(mark, name) {
    const key = `${mark.version}:${name}`;
    if (pngs.has(key)) return pngs.get(key);
    const { size, shape } = SIZES[name];
    // Square, full-bleed artwork: Android and iOS round the corners themselves
    const svg = mark.style === 'custom'
      ? `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512"><image width="512" height="512" preserveAspectRatio="xMidYMid slice" xlink:href="${mark.custom}"/></svg>`
      : markSvg(mark.colors, mark.style, shape);
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
    if (pngs.size > 40) pngs.clear();
    pngs.set(key, png);
    return png;
  }

  app.get(['/manifest.json', '/manifest.webmanifest'], async (req, res) => {
    const mark = await currentMark();
    const v = mark.version;
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/manifest+json').send(JSON.stringify({
      name: 'NatureGram',
      short_name: 'NatureGram',
      description: 'A live naturalist and a community of explorers. Capture the wild, understand it, share the wonder.',
      id: '/',
      start_url: '/feed?source=home',
      scope: '/',
      display: 'standalone',
      background_color: '#fcfaf8',
      theme_color: '#fcfaf8',
      orientation: 'portrait',
      categories: ['education', 'photo', 'social'],
      icons: [
        { src: `/brand/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `/brand/icon-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `/brand/maskable-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));
  });

  app.get('/brand/:name.png', async (req, res) => {
    const name = req.params.name;
    if (!SIZES[name]) return res.status(404).end();
    try {
      const mark = await currentMark();
      const png = render(mark, name);
      // A versioned URL never changes; an unversioned one (apple-touch-icon) is re-checked hourly
      res.setHeader('Cache-Control', req.query.v === mark.version ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      res.type('image/png').send(png);
    } catch (e) {
      log('warn', 'brand icon failed', { name, error: String(e.message).slice(0, 120) });
      res.redirect(302, name === 'icon-192' ? '/icon-192.png' : '/icon-512.png');
    }
  });
}
