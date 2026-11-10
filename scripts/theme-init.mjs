/**
 * The fortnight's palette before the first paint.
 *
 * index.html loads /theme-init.js synchronously in <head>. It works out today's naturalist from the
 * date (the same arithmetic as rotationAt in constants/naturalists.ts) and sets the theme CSS
 * variables from a tiny table generated from constants/palettes.json, so the app never paints in a
 * default colour first. It is an external file because the production CSP forbids inline scripts.
 * services/themeService.ts refines it once React runs (favicon, admin overrides).
 *
 * vite.config.ts serves it in development and emits it into dist/ at build time;
 * server/test/palettes.test.mjs runs it against the app's own rotation.
 *
 * @param {{ periodDays: number, cutover: string, order: string[], legacyOrder: string[],
 *   palettes: Record<string, { primary: string, deep: string, accent: string, vivid: string, gradient: string, text: string }> }} rotation
 * @returns {string}
 */
export function themeInitScript(rotation) {
  const ids = Object.keys(rotation.palettes);
  const table = ids.map(id => {
    const p = rotation.palettes[id];
    return [p.primary, p.deep, p.accent, p.vivid, p.gradient, p.text].map(h => h.slice(1)).join(',');
  });
  const data = {
    p: rotation.periodDays,
    c: rotation.cutover.split('-').map(Number),
    o: rotation.order.map(id => ids.indexOf(id)),
    l: rotation.legacyOrder.map(id => ids.indexOf(id)),
    t: table,
  };
  return `// Generated from constants/palettes.json (scripts/theme-init.mjs): the fortnight's palette before the first paint.
(function () {
  try {
    var R = ${JSON.stringify(data)};
    var now = new Date(), y = now.getFullYear();
    var day = Math.floor((now.getTime() - new Date(y, 0, 0).getTime()) / 86400000);
    var slot = Math.floor(day / R.p);
    var order = now >= new Date(R.c[0], R.c[1] - 1, R.c[2]) ? R.o : R.l;
    var t = R.t[order[slot % order.length]].split(',');
    var rgb = function (h) { return parseInt(h.slice(0, 2), 16) + ' ' + parseInt(h.slice(2, 4), 16) + ' ' + parseInt(h.slice(4, 6), 16); };
    var s = document.documentElement.style;
    s.setProperty('--theme-primary', '#' + t[0]);
    s.setProperty('--theme-primary-rgb', rgb(t[0]));
    s.setProperty('--theme-deep-rgb', rgb(t[1]));
    s.setProperty('--theme-shadow', '#' + t[1]);
    s.setProperty('--theme-shadow-rgb', rgb(t[1]));
    s.setProperty('--theme-accent', '#' + t[2]);
    s.setProperty('--theme-accent-rgb', rgb(t[2]));
    s.setProperty('--theme-vivid-rgb', rgb(t[3]));
    s.setProperty('--theme-accent-vivid-rgb', rgb(t[3]));
    s.setProperty('--theme-primary-gradient', '#' + t[4]);
    s.setProperty('--theme-text', '#' + t[5]);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#' + t[1]);
  } catch (e) { /* keep the neutral defaults in index.css */ }
})();
`;
}
