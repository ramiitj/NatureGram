// Run: node --test server/test/palettes.test.mjs
// The fortnightly palettes as a set: every tone meets its contrast rule, every change of naturalist
// is a change of colour (>= 90 degrees of hue), history keeps its naturalist, and every copy of the
// rotation (first-paint script, share cards, letters) agrees with constants/palettes.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'vm';
import { themeInitScript } from '../../scripts/theme-init.mjs';
import { LETTER_NATURALISTS } from '../authMail.js';

const ROTATION = JSON.parse(fs.readFileSync(new URL('../../constants/palettes.json', import.meta.url), 'utf8'));
// The app's own rotation (constants/naturalists.ts, run with Node's type stripping)
const app = await import('../../constants/naturalists.ts');

const CREAM = '#fcfaf8';
const WHITE = '#ffffff';
const MIN_HUE_GAP = 90;

const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** OKLCH hue in degrees: a perceptual colour wheel (sRGB -> linear -> OKLab). */
const hue = (h) => {
  const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const d = Math.atan2(B, A) * 180 / Math.PI;
  return d < 0 ? d + 360 : d;
};
const hueGap = (a, b) => { const d = Math.abs(hue(a) - hue(b)) % 360; return d > 180 ? 360 - d : d; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('every palette meets its contrast rules', () => {
  const ids = Object.keys(ROTATION.palettes);
  assert.equal(ids.length, 24);
  for (const id of ids) {
    const p = ROTATION.palettes[id];
    for (const k of ['deep', 'primary', 'accent', 'vivid', 'gradient', 'text']) assert.match(p[k], /^#[0-9a-f]{6}$/, `${id}.${k}`);
    assert.ok(contrast(p.deep, CREAM) >= 7, `${id} deep ${p.deep} on cream: ${contrast(p.deep, CREAM).toFixed(2)}`);
    assert.ok(contrast(WHITE, p.primary) >= 4.5, `${id} white on primary ${p.primary}: ${contrast(WHITE, p.primary).toFixed(2)}`);
    // text-theme-primary is also used for text on the page
    assert.ok(contrast(p.primary, CREAM) >= 4.5, `${id} primary ${p.primary} on cream: ${contrast(p.primary, CREAM).toFixed(2)}`);
    assert.ok(contrast(p.accent, CREAM) >= 4.5, `${id} accent ${p.accent} on cream: ${contrast(p.accent, CREAM).toFixed(2)}`);
    // The favicon's white sun stays visible on the primary -> gradient disc (brandMark uses white at >= 2.2)
    assert.ok(contrast(WHITE, p.gradient) >= 2.2, `${id} white sun on gradient ${p.gradient}`);
  }
});

test('the orders are the same 24 naturalists', () => {
  const ids = Object.keys(ROTATION.palettes).sort();
  assert.deepEqual([...ROTATION.order].sort(), ids);
  assert.deepEqual([...ROTATION.legacyOrder].sort(), ids);
  assert.deepEqual(app.NATURALIST_THEMES.map(t => t.id), ROTATION.order);
  assert.deepEqual(app.LEGACY_THEMES.map(t => t.id), ROTATION.legacyOrder);
});

test('neighbouring fortnights are at least 90 degrees apart in hue, including the wrap', () => {
  const o = ROTATION.order;
  const gaps = o.map((id, i) => {
    const next = o[(i + 1) % o.length];
    return [id, next, hueGap(ROTATION.palettes[id].primary, ROTATION.palettes[next].primary)];
  });
  for (const [a, b, g] of gaps) assert.ok(g >= MIN_HUE_GAP, `${a} -> ${b}: ${g.toFixed(1)} degrees`);
});

test('day by day from the cutover through two leap years, every change of naturalist changes colour', () => {
  let prev = app.themeAt(new Date(2026, 10, 15, 12));
  assert.equal(prev.id, 'merian', 'the last legacy fortnight is Merian\'s');
  let changes = 0;
  for (let d = new Date(2026, 10, 16, 12); d < new Date(2033, 0, 2); d.setDate(d.getDate() + 1)) {
    const t = app.themeAt(d);
    if (t.id !== prev.id) {
      changes++;
      const g = hueGap(prev.colors.primary, t.colors.primary);
      assert.ok(g >= MIN_HUE_GAP, `${ymd(d)}: ${prev.id} -> ${t.id} only ${g.toFixed(1)} degrees`);
    }
    prev = t;
  }
  assert.ok(changes > 24 * 6, `saw ${changes} changes`);
});

test('today stays Merian\'s fortnight and Salim Ali comes next; history keeps its naturalists', () => {
  const today = app.rotationAt(new Date(2026, 10, 10, 9));
  assert.equal(today.theme.id, 'merian');
  assert.equal(today.slot, 20);
  // The fortnight runs 1-15 November: the last day is still Merian, the 16th is Salim Ali
  assert.equal(app.themeAt(new Date(2026, 10, 1, 0, 30)).id, 'merian');
  assert.equal(app.themeAt(new Date(2026, 9, 31, 23, 30)).id, 'kimmerer');
  assert.equal(app.themeAt(new Date(2026, 10, 15, 23, 59)).id, 'merian');
  assert.equal(app.themeAt(new Date(2026, 10, 16, 0, 0)).id, 'ali');
  assert.equal(+app.ROTATION_CUTOVER, +new Date(2026, 10, 16));
  // Before the cutover every date has the naturalist it had when it happened (legacy order)
  for (let d = new Date(2024, 0, 1, 12); d < app.ROTATION_CUTOVER; d.setDate(d.getDate() + 1)) {
    const day = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
    assert.equal(app.themeAt(d).id, ROTATION.legacyOrder[Math.floor(day / 15.21) % 24], ymd(d));
  }
  // The cutover is the start of a fortnight
  const cut = app.rotationAt(app.ROTATION_CUTOVER);
  assert.equal(Math.ceil(cut.slot * ROTATION.periodDays), cut.dayOfYear);
});

test('the first-paint script picks the same palette as the app', () => {
  const src = themeInitScript(ROTATION);
  assert.ok(src.length < 4000, `theme-init.js is ${src.length} bytes`);
  const RealDate = Date;
  for (const at of [new RealDate(2026, 10, 10, 8), new RealDate(2026, 10, 16, 0, 5), new RealDate(2026, 11, 31, 20), new RealDate(2027, 0, 1, 1), new RealDate(2028, 11, 31, 12), new RealDate(2025, 5, 3)]) {
    const props = {};
    let themeColor = '';
    const FixedDate = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(at.getTime()); } };
    vm.runInNewContext(src, {
      Date: FixedDate,
      document: {
        documentElement: { style: { setProperty: (k, v) => { props[k] = v; } } },
        querySelector: () => ({ setAttribute: (_k, v) => { themeColor = v; } }),
      },
    });
    const t = app.themeAt(at);
    assert.equal(props['--theme-primary'], t.colors.primary, `${ymd(at)} ${t.id}`);
    assert.equal(props['--theme-accent'], t.colors.accent);
    assert.equal(props['--theme-primary-gradient'], t.colors.primaryGradient);
    assert.equal(props['--theme-deep-rgb'], rgb(t.colors.deep).join(' '));
    assert.equal(props['--theme-vivid-rgb'], rgb(t.colors.vivid).join(' '));
    assert.equal(themeColor, t.colors.deep);
  }
});

test('the server copies follow palettes.json in rotation order', () => {
  const names = Object.fromEntries(app.NATURALIST_THEMES.map(t => [t.id, t.naturalist]));
  assert.deepEqual(LETTER_NATURALISTS.map(r => [r[0], r[2]]), ROTATION.order.map(id => [names[id], ROTATION.palettes[id].primary]));
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const block = server.slice(server.indexOf('const SHARE_THEMES = ['), server.indexOf('const shareTheme ='));
  const rows = [...block.matchAll(/\['([^']+)', '(#[0-9a-f]{6})', '(#[0-9a-f]{6})'\]/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(rows, ROTATION.order.map(id => [names[id], ROTATION.palettes[id].deep, ROTATION.palettes[id].accent]));
});
