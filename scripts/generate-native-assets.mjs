#!/usr/bin/env node
/**
 * Generates the iOS and Android app icons and splash screens from public/icon.svg.
 *
 *   node scripts/generate-native-assets.mjs
 *
 * Uses Playwright's Chromium (already a dev dependency) to rasterise the SVG, so no image
 * library is needed. Writes to the standard Capacitor paths:
 *   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   (1024, opaque, square: iOS masks it)
 *   ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png
 *   android/app/src/main/res/mipmap-* /ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png
 *   android/app/src/main/res/drawable* /splash.png
 *   android/app/src/main/res/values/ic_launcher_background.xml
 *
 * Set PW_CHROMIUM_PATH to a Chromium binary if Playwright's own download is not installed.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPLASH_BG = '#1c1917';   // matches capacitor.config.json SplashScreen.backgroundColor and the theme colour
const ICON_BG = '#1f3d2b';     // the icon's own green, used behind Android adaptive icons

const svg = fs.readFileSync(path.join(ROOT, 'public/icon.svg'), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const defs = (inner.match(/<defs>[\s\S]*?<\/defs>/) || [''])[0];
const motif = inner.replace(/<defs>[\s\S]*?<\/defs>/, '').replace(/<rect[^>]*\/>/, '');

// The sun motif sits in x 85..427, y 85..427 of the 512 canvas.
const MOTIF_CX = 256, MOTIF_CY = 256, MOTIF_SPAN = 342;

const icon = ({ square = false, round = false } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  ${round ? '<circle cx="256" cy="256" r="256" fill="url(#g)"/>' : `<rect width="512" height="512" ${square ? '' : 'rx="112"'} fill="url(#g)"/>`}
  ${motif}</svg>`;

/** Motif only, scaled so its span is `fraction` of the canvas (transparent background). */
const motifOnly = (fraction) => {
  const s = (512 * fraction) / MOTIF_SPAN;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  <g transform="translate(256 256) scale(${s}) translate(${-MOTIF_CX} ${-MOTIF_CY})">${motif}</g></svg>`;
};

/** Splash: the rounded icon tile centred on the brand background. */
const splash = (w, h) => {
  const tile = Math.round(Math.min(w, h) * 0.28);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${SPLASH_BG}"/>
  <svg x="${(w - tile) / 2}" y="${(h - tile) / 2}" width="${tile}" height="${tile}" viewBox="0 0 512 512">${defs}
    <rect width="512" height="512" rx="112" fill="url(#g)"/>${motif}</svg></svg>`;
};

const findChromium = () => {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  const base = '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  for (const d of fs.readdirSync(base).sort().reverse()) {
    const p = path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
};

let browser;
try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: findChromium() }); }
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(markup, w, h, out, { transparent = false } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;background:${transparent ? 'transparent' : SPLASH_BG}}svg{display:block;width:${w}px;height:${h}px}</style></head><body>${markup}</body></html>`);
  const file = path.join(ROOT, out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  console.log('wrote', out, `${w}x${h}`);
}

// iOS: one 1024 universal icon, full-bleed and opaque (iOS applies its own mask)
await render(icon({ square: true }), 1024, 1024, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await render(splash(2732, 2732), 2732, 2732, `ios/App/App/Assets.xcassets/Splash.imageset/${f}`);
}

// Android launcher icons
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  const res = `android/app/src/main/res/mipmap-${d}`;
  await render(icon(), 48 * k, 48 * k, `${res}/ic_launcher.png`, { transparent: true });
  await render(icon({ round: true }), 48 * k, 48 * k, `${res}/ic_launcher_round.png`, { transparent: true });
  // Adaptive foreground: 108dp canvas, keep the motif inside the 66dp safe zone
  await render(motifOnly(0.56), 108 * k, 108 * k, `${res}/ic_launcher_foreground.png`, { transparent: true });
}
fs.writeFileSync(path.join(ROOT, 'android/app/src/main/res/values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ICON_BG.toUpperCase()}</color>\n</resources>\n`);

// Android splash screens (same sizes Capacitor generates)
const SPLASH = {
  'drawable': [480, 320],
  'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(SPLASH)) await render(splash(w, h), w, h, `android/app/src/main/res/${dir}/splash.png`);

await browser.close();
