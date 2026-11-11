/**
 * "From Wikipedia" for a species: the summary paragraph of its English Wikipedia article.
 *
 *   GET /api/species/summary?name=Indian%20Roller   { title, extract, url, license } | { extract: '' }
 *
 * The server fetches it and keeps it in memory, so the species sheet in the app never contacts
 * Wikipedia itself (no one's reading is visible to a third party) and repeat views are instant.
 * Text only: Wikipedia text is CC BY-SA 4.0 and is shown with that credit and a link to the article.
 * Article pictures are left out, because many on Wikipedia are not free to reuse.
 */
import rateLimit from 'express-rate-limit';

const UA = 'NatureGram/1.0 (https://thenaturegram.com)';
const TTL_MS = 7 * 86_400_000;
const FAIL_TTL_MS = 30 * 60_000;
const TIMEOUT_MS = 6000;
const MAX_ENTRIES = 800;
export const LICENSE = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };

/** A name worth asking about: letters, spaces and a little punctuation, at most 100 characters. */
export const cleanSpeciesName = (raw) => String(raw || '')
  .replace(/\(.*?\)/g, ' ')
  .replace(/[^\p{L}\p{M}\s'.-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 100);

/** Titles to try, in order: the whole name, then its first two words ("Corvus splendens protegatus"). */
export const candidatesFor = (name) => {
  const clean = cleanSpeciesName(name);
  if (clean.length < 2) return [];
  return [...new Set([clean, clean.split(' ').slice(0, 2).join(' ')])].filter(c => c.length >= 2);
};

const cache = new Map(); // key -> { at, ok, data }
const remember = (key, ok, data) => {
  cache.delete(key);
  cache.set(key, { at: Date.now(), ok, data });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
};

async function fetchSummary(title) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`, {
      headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j.type === 'disambiguation' || !j.extract) return null;
    const url = String(j.content_urls?.desktop?.page || '');
    return {
      title: String(j.title || title).slice(0, 200),
      extract: String(j.extract).slice(0, 2000),
      url: /^https:\/\/en\.wikipedia\.org\//.test(url) ? url : `https://en.wikipedia.org/wiki/${encodeURIComponent(String(j.title || title).replace(/ /g, '_'))}`,
      license: LICENSE,
    };
  } finally { clearTimeout(t); }
}

export async function speciesSummary(name) {
  const tries = candidatesFor(name);
  if (!tries.length) return { extract: '' };
  const key = tries[0].toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.ok ? TTL_MS : FAIL_TTL_MS)) return hit.data;
  try {
    let found = null;
    for (const c of tries) { found = await fetchSummary(c); if (found) break; }
    const data = found || { extract: '' };
    remember(key, true, data);
    return data;
  } catch (e) {
    // Wikipedia slow or down: say so briefly, and ask again in half an hour
    if (hit) return hit.data;
    const data = { extract: '', unavailable: true };
    remember(key, false, data);
    return data;
  }
}

export function mountSpeciesWiki(app, { log } = {}) {
  const limiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
  app.get('/api/species/summary', limiter, async (req, res) => {
    // Public, read-only text: the native apps (another origin) may read it too
    res.set('Access-Control-Allow-Origin', '*');
    const name = String(req.query.name || '');
    if (!candidatesFor(name).length) return res.status(400).json({ error: 'A species name is needed' });
    try {
      const out = await speciesSummary(name);
      res.set('Cache-Control', out.unavailable ? 'no-store' : 'public, max-age=3600, stale-while-revalidate=86400').json(out);
    } catch (e) {
      log?.('warn', 'species summary failed', { error: String(e?.message || e).slice(0, 120) });
      res.status(502).json({ extract: '', unavailable: true });
    }
  });
}
