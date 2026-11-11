/**
 * "From Wikipedia" for the naturalist of the fortnight: the opening of their Wikipedia article and,
 * when its licence allows reuse, their portrait.
 *
 *   GET /api/naturalist/:id/about      { source, title, extract, url, description, portrait|null, textLicense }
 *   GET /api/naturalist/:id/portrait   the portrait image itself (served by us)
 *
 * Fetched by the server, once a fortnight, and kept in memory and in Firestore
 * (naturalist_about/{id}), so the page opens at once, keeps working when Wikipedia is slow, and
 * visitors' phones never contact Wikipedia or Wikimedia (no one's reading is visible to them).
 *
 * Licences:
 *  - Wikipedia text is CC BY-SA 4.0: shown with the credit and a link to the article.
 *  - A portrait is shown only when Wikimedia Commons says it is free: public domain, CC0, CC BY or
 *    CC BY-SA, and not marked non-free. Images kept on English Wikipedia itself (not Commons) are
 *    usually "fair use", which Wikipedia may use but we may not, so they are never shown.
 *
 * Fallbacks: no free portrait on the article → Wikidata's image (P18, always on Commons) → none.
 * No article → Wikidata's description (CC0) → nothing, and the page keeps NatureGram's own words.
 */

const UA = 'NatureGram/1.0 (https://thenaturegram.com; naturalist pages)';
const TTL_MS = 14 * 86_400_000;
const FAIL_TTL_MS = 30 * 60_000;
const TIMEOUT_MS = 6000;

/** Exact article titles, so the wrong person can never be shown (several names have namesakes). */
export const WIKI_TITLES = {
  wilson: 'E. O. Wilson',
  wallace: 'Alfred Russel Wallace',
  audubon: 'John James Audubon',
  goodall: 'Jane Goodall',
  humboldt: 'Alexander von Humboldt',
  maathai: 'Wangari Maathai',
  muir: 'John Muir',
  emerson: 'Ralph Waldo Emerson',
  darwin: 'Charles Darwin',
  anning: 'Mary Anning',
  carson: 'Rachel Carson',
  attenborough: 'David Attenborough',
  fossey: 'Dian Fossey',
  carver: 'George Washington Carver',
  earle: 'Sylvia Earle',
  irwin: 'Steve Irwin',
  cousteau: 'Jacques Cousteau',
  potter: 'Beatrix Potter',
  linnaeus: 'Carl Linnaeus',
  kimmerer: 'Robin Wall Kimmerer',
  merian: 'Maria Sibylla Merian',
  ali: 'Salim Ali',
  leopold: 'Aldo Leopold',
  thoreau: 'Henry David Thoreau',
};

const PARTIAL_TTL_MS = 6 * 3600_000;

const getJson = async (url, retry = true) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
    if (r.status === 404) return null;
    // Asked to slow down: wait once, politely, then give up for now (the caller retries in hours)
    if (r.status === 429 && retry) { clearTimeout(t); await new Promise(res => setTimeout(res, 2500)); return getJson(url, false); }
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
    return await r.json();
  } finally { clearTimeout(t); }
};

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** The first two or three sentences, at most about 420 characters, never cut mid-sentence. */
export const shortExtract = (text, max = 420) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+(?:["')\]]+)?(\s|$)/g) || [t];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  return (out.trim() || `${t.slice(0, max).replace(/\s+\S*$/, '')}…`);
};

/** A Commons file name from an upload.wikimedia.org URL; null for files kept on a local wiki. */
export const commonsFileOf = (url) => {
  const m = /\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i.exec(String(url || ''));
  return m ? decodeURIComponent(m[1]) : null;
};

/** Free to show on NatureGram: public domain, CC0, CC BY, CC BY-SA (any version), and not non-free. */
export const isFreeLicence = (meta) => {
  if (!meta) return false;
  if (String(meta.NonFree?.value || '').toLowerCase() === 'true') return false;
  const name = String(meta.LicenseShortName?.value || meta.License?.value || '').toLowerCase();
  if (!name) return false;
  if (/\b(nc|nd)\b|non-?commercial|no-?deriv|fair use|non-?free/.test(name)) return false;
  return /public domain|^pd\b|^pd-|cc0|cc[- ]by(-sa)?\b|cc[- ]by[- ]sa/.test(name);
};

async function commonsPortrait(file) {
  if (!file) return null;
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=480&titles=${encodeURIComponent(`File:${file}`)}`;
  const j = await getJson(api);
  const info = j?.query?.pages?.[0]?.imageinfo?.[0];
  const meta = info?.extmetadata;
  if (!info || !isFreeLicence(meta)) return null;
  return {
    imageUrl: info.thumburl || info.url,
    width: info.thumbwidth || info.width || null,
    height: info.thumbheight || info.height || null,
    artist: stripHtml(meta.Artist?.value).slice(0, 120) || 'Unknown',
    license: stripHtml(meta.LicenseShortName?.value).slice(0, 60),
    licenseUrl: meta.LicenseUrl?.value || null,
    filePage: info.descriptionurl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
  };
}

async function wikidataImageFile(qid) {
  if (!/^Q\d+$/.test(String(qid || ''))) return null;
  const j = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const ent = j?.entities?.[qid];
  return { file: ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value || null, description: ent?.descriptions?.en?.value || null };
}

/** Look a naturalist up (no cache). */
export async function lookupNaturalist(id) {
  const title = WIKI_TITLES[id];
  if (!title) return { source: null };
  const sum = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (sum && sum.type !== 'disambiguation' && sum.extract) {
    // "Not free" is an answer; a failed lookup is not, so it is tried again in a few hours
    let incomplete = false;
    const tryPortrait = (f) => commonsPortrait(f).catch(() => { incomplete = true; return null; });
    let portrait = await tryPortrait(commonsFileOf(sum.originalimage?.source || sum.thumbnail?.source));
    if (!portrait && sum.wikibase_item) {
      const wd = await wikidataImageFile(sum.wikibase_item).catch(() => { incomplete = true; return null; });
      if (wd?.file) portrait = await tryPortrait(wd.file);
    }
    if (portrait) incomplete = false;
    return {
      source: 'wikipedia',
      title: sum.title,
      description: sum.description || null,
      extract: shortExtract(sum.extract),
      url: sum.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      textLicense: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      portrait,
      ...(incomplete ? { incomplete: true } : {}),
    };
  }
  return { source: null };
}

export function mountNaturalistWiki(app, { db, log }) {
  const mem = new Map(); // id -> { at, data, ttl }
  const images = new Map(); // id -> { at, type, buf }

  async function about(id) {
    const hit = mem.get(id);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
    const store = db?.();
    if (store) {
      try {
        const snap = await store.doc(`naturalist_about/${id}`).get();
        const d = snap.exists ? snap.data() : null;
        if (d?.fetchedAt && Date.now() - d.fetchedAt < TTL_MS && d.data) { mem.set(id, { at: d.fetchedAt, data: d.data, ttl: TTL_MS }); return d.data; }
      } catch { /* the cache is optional */ }
    }
    try {
      const data = await lookupNaturalist(id);
      mem.set(id, { at: Date.now(), data, ttl: data.incomplete ? PARTIAL_TTL_MS : TTL_MS });
      if (store && !data.incomplete) store.doc(`naturalist_about/${id}`).set({ fetchedAt: Date.now(), data }).catch(() => {});
      return data;
    } catch (e) {
      log?.('warn', 'naturalist wiki lookup failed', { id, error: String(e?.message || e).slice(0, 160) });
      // Serve what we had, however old; otherwise nothing for a while (the page keeps its own words)
      if (hit) { mem.set(id, { ...hit, at: Date.now(), ttl: FAIL_TTL_MS }); return hit.data; }
      const none = { source: null };
      mem.set(id, { at: Date.now(), data: none, ttl: FAIL_TTL_MS });
      return none;
    }
  }

  app.get('/api/naturalist/:id/about', async (req, res) => {
    const id = String(req.params.id || '');
    if (!WIKI_TITLES[id]) return res.status(404).json({ error: 'Unknown naturalist' });
    const data = await about(id);
    const { incomplete, ...pub } = data;
    const out = pub.portrait ? { ...pub, portrait: { ...pub.portrait, imageUrl: undefined, src: `/api/naturalist/${id}/portrait` } } : pub;
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400').json(out);
  });

  app.get('/api/naturalist/:id/portrait', async (req, res) => {
    const id = String(req.params.id || '');
    if (!WIKI_TITLES[id]) return res.status(404).end();
    try {
      const cached = images.get(id);
      if (cached && Date.now() - cached.at < TTL_MS) return res.set({ 'Content-Type': cached.type, 'Cache-Control': 'public, max-age=86400' }).send(cached.buf);
      const data = await about(id);
      const src = data?.portrait?.imageUrl;
      if (!src || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(src)) return res.status(404).end();
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      const r = await fetch(src, { headers: { 'User-Agent': UA }, signal: ctl.signal }).finally(() => clearTimeout(t));
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\/(jpeg|png|webp|gif)/.test(type)) return res.status(502).end();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 3_000_000) return res.status(502).end();
      images.set(id, { at: Date.now(), type, buf });
      res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' }).send(buf);
    } catch {
      res.status(502).end();
    }
  });
}
