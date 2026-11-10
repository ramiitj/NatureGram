/**
 * Public, crawlable pages and discovery files:
 *   /robots.txt  /sitemap.xml  /sitemaps/*.xml  /llms.txt  /llms-full.txt  /<INDEXNOW_KEY>.txt
 *   /species  /species/:slug  /naturalists  /naturalists/:id  /explorer/:username  /about
 * plus page-specific head tags (and readable fallback content for /post/:id) injected into the
 * app shell for every app route.
 *
 * Data comes from Firestore through the Admin SDK and is filtered by publicPost / publicExplorer
 * (server/seo.js). The species corpus is the most recent public sightings, rebuilt at most hourly
 * and served stale while it refreshes, so crawls cost almost nothing. Without the store the pages
 * answer 503 (with Retry-After) instead of failing.
 */
import fs from 'fs';
import {
  publicPost, publicExplorer, buildCorpus, slugify, robotsTxt, aiCrawlerMode, sitemapIndexXml, urlsetXml, llmsTxt,
  graph, organizationLd, websiteLd, appLd, breadcrumbLd, postLd, POST_ID_RE, USERNAME_RE, clip, redactContacts,
  currentNaturalistIndex, mergeNaturalists, origin, dayDate, fieldDate,
} from './seo.js';
import {
  speciesPage, speciesIndexPage, naturalistPage, naturalistsIndexPage, explorerPage, aboutPage, unavailablePage,
  shellHead, injectShell, postFallbackBody,
} from './seoPages.js';
import { INDEXNOW_KEY } from './indexNow.js';

const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const CORPUS_LIMIT = Math.min(10_000, Math.max(50, num(process.env.SEO_CORPUS_LIMIT, 2000)));
const CORPUS_TTL_MS = 60 * 60_000;
const RETRY_FAILED_MS = 60_000;
const SITEMAP_PAGE = 1000;
// When the public pages' wording last changed (lastmod for the static sitemap)
const STATIC_UPDATED = '2026-11-10';
const PUBLIC_PAGE_CACHE = 'public, max-age=300, stale-while-revalidate=3600';
// App routes that must never be indexed (account, private and transient screens)
export const NOINDEX_ROUTE = /^\/(?:admin|messages|review|lens|drafts|auth\/action|guardian|welcome|journal|profile)(?:\/|$)/;
const POST_FIELDS = ['userId', 'labels', 'tags', 'aiFlags', 'showLocation', 'locationArea', 'timestamp', 'observedAt', 'imageUrl', 'thumbnailUrl', 'thumbSmallUrl',
  'mediaType', 'title', 'caption', 'behavior', 'aiInsight', 'reportStatus', 'moderation', 'communityVerified', 'isPublic', 'items', 'aiIdentifications'];
const PROFILE_FIELDS = ['username', 'isAnonymous', 'ageBand', 'profilePrivate', 'bio'];

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms).unref?.())]);

class Lru {
  constructor(max, ttl) { this.max = max; this.ttl = ttl; this.m = new Map(); }
  get(k) { const v = this.m.get(k); if (!v) return undefined; if (Date.now() - v.at > this.ttl) { this.m.delete(k); return undefined; } return v.value; }
  set(k, value) { this.m.delete(k); this.m.set(k, { at: Date.now(), value }); if (this.m.size > this.max) this.m.delete(this.m.keys().next().value); }
}

/** users/{uid} for each id: data, null (no such document) or absent from the map (couldn't be read). */
async function loadProfiles(db, uids) {
  const out = new Map();
  const ids = [...new Set(uids)].filter(u => typeof u === 'string' && u && !u.includes('/') && u.length <= 128);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const snaps = await withTimeout(db.getAll(...chunk.map(u => db.doc(`users/${u}`)), { fieldMask: PROFILE_FIELDS }), 10_000, 'profiles');
      snaps.forEach((s, j) => out.set(chunk[j], s.exists ? s.data() : null));
    } catch { /* left out: their sightings are skipped rather than guessed about */ }
  }
  return out;
}

export function canonicalHost(publicHost) {
  return (req, res, next) => {
    const h = String(req.hostname || '').toLowerCase();
    if (h === `www.${publicHost}`) return res.redirect(req.method === 'GET' || req.method === 'HEAD' ? 301 : 308, `https://${publicHost}${req.originalUrl}`);
    next();
  };
}

/**
 * deps: { db, log, publicHost, shell(url) -> index.html, naturalists() -> { themes, extras }, notFoundFile, iosUrl, androidUrl }
 * Returns { appShell } for the app-route fallback.
 */
export function mountSeo(app, deps) {
  const { log, publicHost: host } = deps;
  const mode = aiCrawlerMode(process.env.AI_CRAWLERS);
  const appNodes = appLd(host, { iosUrl: deps.iosUrl || '', androidUrl: deps.androidUrl || '' });

  // ---------------------------------------------------------------- data
  const corpus = { value: null, at: 0, promise: null, failedAt: 0 };
  async function buildIt() {
    const db = deps.db();
    if (!db) throw new Error('store unavailable');
    const snap = await withTimeout(
      db.collection('ecosystem_feed').where('isPublic', '==', true).orderBy('timestamp', 'desc').limit(CORPUS_LIMIT).select(...POST_FIELDS).get(),
      20_000, 'corpus');
    const docs = snap.docs.map(d => ({ id: d.id, p: d.data() }));
    const profiles = await loadProfiles(db, docs.map(d => d.p.userId));
    const c = buildCorpus(docs.map(({ id, p }) => publicPost(id, p, profiles.get(p.userId))));
    c.builtAt = Date.now();
    c.newestMs = c.posts[0]?.ms || 0;
    log('info', 'seo corpus built', { docs: docs.length, posts: c.posts.length, species: c.species.size });
    return c;
  }
  function getCorpus() {
    const now = Date.now();
    if (corpus.value && now - corpus.at < CORPUS_TTL_MS) return Promise.resolve(corpus.value);
    if (!corpus.promise && !(corpus.failedAt && now - corpus.failedAt < RETRY_FAILED_MS)) {
      corpus.promise = buildIt()
        .then(v => { corpus.value = v; corpus.at = Date.now(); corpus.failedAt = 0; return v; })
        .catch(err => { corpus.failedAt = Date.now(); log('warn', 'seo corpus unavailable', { error: String(err.message).slice(0, 160) }); throw err; })
        .finally(() => { corpus.promise = null; });
      corpus.promise.catch(() => {});
    }
    if (corpus.value) return Promise.resolve(corpus.value); // stale while it refreshes
    return corpus.promise || Promise.reject(new Error('store unavailable'));
  }
  const corpusIfReady = () => { getCorpus().catch(() => {}); return corpus.value; };

  let naturalistList = null;
  async function getNaturalists() {
    if (naturalistList) return naturalistList;
    const raw = await deps.naturalists();
    const list = mergeNaturalists(raw?.themes, raw?.extras);
    if (!list.length) throw new Error('no naturalists');
    naturalistList = list;
    return list;
  }

  // After a store failure, pages answer at once (503 or default meta) for a minute instead of each waiting out a timeout
  let storeDownUntil = 0;
  const posts = new Lru(500, 5 * 60_000);
  async function loadPost(id) {
    const hit = posts.get(id);
    if (hit) return hit;
    const db = deps.db();
    if (!db || Date.now() < storeDownUntil) return { status: 'unavailable' };
    try {
      const snap = await withTimeout(db.doc(`ecosystem_feed/${id}`).get(), 6000, 'post');
      let out;
      if (!snap.exists) out = { status: 'missing' };
      else {
        const p = snap.data();
        if (p.reportStatus === 'hidden') out = { status: 'gone' };
        else {
          const profiles = p.isPublic === true ? await loadProfiles(db, [p.userId]) : new Map();
          const pub = publicPost(id, p, profiles.get(p.userId));
          out = pub ? { status: 'ok', post: pub } : { status: 'missing' };
        }
      }
      posts.set(id, out);
      return out;
    } catch (e) {
      log('warn', 'seo post unavailable', { error: String(e.message).slice(0, 120) });
      storeDownUntil = Date.now() + RETRY_FAILED_MS;
      return { status: 'unavailable' };
    }
  }
  const slugFor = (p, c) => {
    if (!c) return null;
    const s = c.aliases.get(slugify(p.scientific || p.name));
    return s && c.species.has(s) ? s : null;
  };

  const explorers = new Lru(300, 10 * 60_000);
  async function loadExplorer(username) {
    const key = username.toLowerCase();
    const hit = explorers.get(key);
    if (hit) return hit;
    const db = deps.db();
    if (!db || Date.now() < storeDownUntil) return { status: 'unavailable' };
    try {
      let snap = await withTimeout(db.collection('users').where('usernameLower', '==', key).limit(3).get(), 6000, 'explorer');
      if (snap.empty) snap = await withTimeout(db.collection('users').where('username', '==', username).limit(3).get(), 6000, 'explorer');
      const matches = snap.docs.filter(d => String(d.data().username || '').toLowerCase() === key);
      let out = { status: 'missing' };
      // Exactly one public profile, or nothing: an ambiguous name never shows anyone's sightings
      if (matches.length === 1 && publicExplorer(matches[0].data())) {
        const profile = matches[0].data();
        const ps = await withTimeout(db.collection('ecosystem_feed').where('userId', '==', matches[0].id).orderBy('timestamp', 'desc').limit(120).select(...POST_FIELDS).get(), 8000, 'explorer posts');
        const list = ps.docs.map(d => publicPost(d.id, d.data(), profile)).filter(Boolean);
        if (list.length) out = { status: 'ok', username: publicExplorer(profile), bio: clip(redactContacts(profile.bio || ''), 300), posts: list };
      }
      explorers.set(key, out);
      return out;
    } catch (e) {
      log('warn', 'seo explorer unavailable', { error: String(e.message).slice(0, 120) });
      storeDownUntil = Date.now() + RETRY_FAILED_MS;
      return { status: 'unavailable' };
    }
  }

  // ---------------------------------------------------------------- responses
  const sendPage = (res, html, status = 200) => {
    res.status(status).setHeader('Cache-Control', status === 200 ? PUBLIC_PAGE_CACHE : 'no-cache');
    res.type('html').send(html);
  };
  const notFound = (res) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (deps.notFoundFile && fs.existsSync(deps.notFoundFile)) return res.status(404).sendFile(deps.notFoundFile, { dotfiles: 'allow' });
    return res.status(404).type('html').send('<!doctype html><meta name="robots" content="noindex"><title>Off the trail · NatureGram</title><p>This page isn\'t in the notebook. <a href="/">Open NatureGram</a></p>');
  };
  const unavailable = (res, path) => {
    res.setHeader('Retry-After', '120');
    res.setHeader('X-Robots-Tag', 'noindex');
    sendPage(res, unavailablePage({ host, path }), 503);
  };
  const text = (res, body, type = 'text/plain') => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type(type).send(body);
  };
  // /species/x/ -> /species/x
  app.use(['/species', '/naturalists', '/explorer', '/about'], (req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.originalUrl.split('?')[0].length > 1 && /\/$/.test(req.originalUrl.split('?')[0])) {
      return res.redirect(301, req.originalUrl.replace(/\/+(\?|$)/, '$1'));
    }
    next();
  });

  // ---------------------------------------------------------------- discovery files
  app.get('/robots.txt', (req, res) => text(res, robotsTxt({ host, mode })));

  if (INDEXNOW_KEY) app.get(`/${INDEXNOW_KEY}.txt`, (req, res) => text(res, INDEXNOW_KEY));

  const xmlCache = new Map();
  const cachedXml = (key, builtAt, make) => {
    const hit = xmlCache.get(key);
    if (hit && hit.builtAt === builtAt) return hit.xml;
    const xml = make();
    xmlCache.set(key, { builtAt, xml });
    return xml;
  };
  const xml = (res, body) => { res.setHeader('Cache-Control', 'public, max-age=3600'); res.type('application/xml').send(body); };

  app.get('/sitemap.xml', async (req, res) => {
    const c = await getCorpus().catch(() => null);
    const today = dayDate(Date.now());
    const pages = c ? Math.max(1, Math.ceil(c.posts.length / SITEMAP_PAGE)) : 1;
    const last = c?.newestMs ? dayDate(c.newestMs) : undefined;
    xml(res, cachedXml('index', c?.builtAt || 0, () => sitemapIndexXml([
      { loc: `${origin(host)}/sitemaps/static.xml`, lastmod: last || STATIC_UPDATED },
      { loc: `${origin(host)}/sitemaps/naturalists.xml`, lastmod: today },
      { loc: `${origin(host)}/sitemaps/species.xml`, lastmod: last },
      { loc: `${origin(host)}/sitemaps/explorers.xml`, lastmod: last },
      ...Array.from({ length: pages }, (_, i) => ({ loc: `${origin(host)}/sitemaps/posts-${i + 1}.xml`, lastmod: last })),
    ])));
  });

  app.get('/sitemaps/static.xml', async (req, res) => {
    const c = corpusIfReady();
    const last = c?.newestMs ? dayDate(c.newestMs) : STATIC_UPDATED;
    xml(res, urlsetXml([
      { loc: `${origin(host)}/`, lastmod: last },
      { loc: `${origin(host)}/explore`, lastmod: last },
      { loc: `${origin(host)}/species`, lastmod: last },
      { loc: `${origin(host)}/naturalists`, lastmod: STATIC_UPDATED },
      { loc: `${origin(host)}/about`, lastmod: STATIC_UPDATED },
      { loc: `${origin(host)}/privacy.html`, lastmod: STATIC_UPDATED },
      { loc: `${origin(host)}/terms.html`, lastmod: STATIC_UPDATED },
    ]));
  });

  app.get('/sitemaps/naturalists.xml', async (req, res) => {
    try {
      const list = await getNaturalists();
      xml(res, urlsetXml(list.map(n => ({ loc: `${origin(host)}/naturalists/${n.id}`, lastmod: STATIC_UPDATED }))));
    } catch { res.setHeader('Retry-After', '120'); res.status(503).type('text/plain').send('Unavailable'); }
  });

  const corpusXml = (name, make) => async (req, res) => {
    let c;
    try { c = await getCorpus(); } catch { res.setHeader('Retry-After', '120'); return res.status(503).type('text/plain').send('Unavailable'); }
    const body = make(c, req);
    if (body === null) return notFound(res);
    xml(res, cachedXml(`${name}:${req.params.page || ''}`, c.builtAt, () => body));
  };
  app.get('/sitemaps/species.xml', corpusXml('species', (c) => urlsetXml([...c.species.values()].map(s => ({
    loc: `${origin(host)}/species/${s.slug}`, lastmod: dayDate(s.lastMs) || undefined, images: s.posts.map(p => p.image).filter(Boolean).slice(0, 3),
  })))));
  app.get('/sitemaps/explorers.xml', corpusXml('explorers', (c) => urlsetXml([...c.explorers.values()].map(x => ({
    loc: `${origin(host)}/explorer/${encodeURIComponent(x.username)}`, lastmod: dayDate(x.lastMs) || undefined,
  })))));
  app.get('/sitemaps/posts-:page.xml', corpusXml('posts', (c, req) => {
    const page = Number(req.params.page);
    if (!Number.isInteger(page) || page < 1) return null;
    const slice = c.posts.slice((page - 1) * SITEMAP_PAGE, page * SITEMAP_PAGE);
    if (!slice.length && page > 1) return null;
    return urlsetXml(slice.map(p => ({ loc: `${origin(host)}/post/${encodeURIComponent(p.id)}`, lastmod: dayDate(p.ms) || undefined, images: p.image ? [p.image] : [] })));
  }));

  const llms = (full) => async (req, res) => {
    const c = await getCorpus().catch(() => null);
    const list = await getNaturalists().catch(() => []);
    text(res, llmsTxt({ host, corpus: c, naturalists: list, full }), 'text/plain; charset=utf-8');
  };
  app.get('/llms.txt', llms(false));
  app.get('/llms-full.txt', llms(true));

  // ---------------------------------------------------------------- pages
  app.get('/about', (req, res) => sendPage(res, aboutPage({ host, appLdNodes: appNodes })));

  app.get('/species', async (req, res) => {
    try { sendPage(res, speciesIndexPage({ host, corpus: await getCorpus() })); } catch { unavailable(res, '/species'); }
  });

  app.get('/species/:slug', async (req, res) => {
    const raw = String(req.params.slug || '');
    if (raw.length > 160) return notFound(res);
    let c;
    try { c = await getCorpus(); } catch { return unavailable(res, `/species/${slugify(raw)}`); }
    const target = c.aliases.get(slugify(raw));
    if (!target || !c.species.has(target)) return notFound(res);
    if (target !== raw) return res.redirect(301, `/species/${target}`);
    sendPage(res, speciesPage({ host, corpus: c, s: c.species.get(target) }));
  });

  app.get('/naturalists', async (req, res) => {
    try {
      const list = await getNaturalists();
      sendPage(res, naturalistsIndexPage({ host, list, currentIndex: currentNaturalistIndex(new Date(), list.length) }));
    } catch { unavailable(res, '/naturalists'); }
  });

  app.get('/naturalists/:id', async (req, res) => {
    let list;
    try { list = await getNaturalists(); } catch { return unavailable(res, '/naturalists'); }
    const id = String(req.params.id || '').toLowerCase();
    const index = list.findIndex(n => n.id === id);
    if (index < 0) return notFound(res);
    if (id !== req.params.id) return res.redirect(301, `/naturalists/${id}`);
    const c = await getCorpus().catch(() => null);
    const tag = list[index].challengeTag.toLowerCase();
    const answers = c ? c.posts.filter(p => p.tags.includes(tag)) : [];
    sendPage(res, naturalistPage({ host, list, index, answers, current: index === currentNaturalistIndex(new Date(), list.length) }));
  });

  app.get('/explorer/:username', async (req, res) => {
    const username = String(req.params.username || '');
    if (!USERNAME_RE.test(username)) return notFound(res);
    const r = await loadExplorer(username);
    if (r.status === 'unavailable') return unavailable(res, `/explorer/${encodeURIComponent(username)}`);
    if (r.status !== 'ok') return notFound(res);
    if (r.username !== username) return res.redirect(301, `/explorer/${encodeURIComponent(r.username)}`);
    const c = corpusIfReady();
    const list = r.posts.map(p => ({ ...p, slug: slugFor(p, c) }));
    sendPage(res, explorerPage({ host, username: r.username, bio: r.bio, posts: list, corpus: c }));
  });

  // ---------------------------------------------------------------- the app shell, with the right head for each route
  const DEFAULT_TITLE = 'NatureGram: AI field guide & nature community';
  const DEFAULT_DESC = "Point your camera at nature and a live AI naturalist tells you what you're seeing and why it behaves that way. Keep a field journal and share discoveries with explorers worldwide.";
  const ROUTE_META = {
    '/': { title: DEFAULT_TITLE, description: DEFAULT_DESC },
    '/explore': { title: 'Explore wild sightings: search plants, animals and fungi · NatureGram', description: 'Search sightings of wild plants, birds, insects, fungi and more shared by NatureGram explorers, and see this fortnight\'s naturalist challenge.', crumb: 'Explore' },
    '/feed': { title: 'The wild feed: fresh nature sightings · NatureGram', description: 'The latest wild plants, animals, fungi and sounds noticed and shared by explorers on NatureGram.', crumb: 'Feed' },
    '/reels': { title: 'Moments: short nature videos · NatureGram', description: 'Short videos of wild behaviour recorded by NatureGram explorers.', crumb: 'Moments' },
  };
  const baseLd = (extra = []) => graph(organizationLd(host), websiteLd(host), appNodes, extra);

  async function appShell(req, res) {
    const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : '/';
    let html;
    try { html = await deps.shell(req.originalUrl); } catch (e) { log('error', 'app shell unavailable', { error: String(e.message).slice(0, 120) }); return res.status(500).send('Unavailable'); }
    res.setHeader('Cache-Control', 'no-cache');
    let status = 200;
    let head;
    let root = '';
    const postId = /^\/post\/([A-Za-z0-9_-]{1,128})$/.exec(path)?.[1];
    if (postId && POST_ID_RE.test(postId)) {
      const r = await loadPost(postId);
      if (r.status === 'ok') {
        const p = r.post;
        const c = corpusIfReady();
        const slug = slugFor(p, c);
        const name = p.name || p.title || 'A wild sighting';
        const title = clip(`${name}${p.scientific && p.scientific !== name ? ` (${p.scientific})` : ''}${p.area ? `, seen near ${p.area}` : ''} · NatureGram`, 120);
        const description = clip(p.caption || p.observed || p.insight || `${p.author || 'An explorer'} recorded ${name}${p.area ? ` near ${p.area}` : ''} on NatureGram.`, 300);
        const crumbs = [{ name: 'NatureGram', path: '/' }, ...(slug ? [{ name: c.species.get(slug).name, path: `/species/${slug}` }] : []), { name: p.ms ? `Sighting, ${fieldDate(p.ms)}` : name, path }];
        head = shellHead({ host, path, title, description, image: p.image || p.thumb, imageAlt: name, type: 'article', ld: graph(organizationLd(host), websiteLd(host), breadcrumbLd(host, crumbs), postLd(host, p, { slug })) });
        root = postFallbackBody(p, slug);
      } else {
        // Hidden: gone for good. Private, waiting for review, a teen's, or unknown: indistinguishable 404.
        // The app still loads, so an owner opening their own private sighting sees it as before.
        if (r.status === 'gone') status = 410;
        else if (r.status === 'missing') status = 404;
        const noindex = r.status !== 'unavailable';
        if (noindex) res.setHeader('X-Robots-Tag', 'noindex');
        head = shellHead({ host, path, title: 'A sighting · NatureGram', description: DEFAULT_DESC, noindex });
      }
    } else if (NOINDEX_ROUTE.test(path)) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      head = shellHead({ host, path, title: 'NatureGram', description: DEFAULT_DESC, noindex: true });
    } else {
      const m = ROUTE_META[path] || ROUTE_META['/'];
      const searching = path === '/explore' && typeof req.query.q === 'string' && req.query.q.trim();
      head = shellHead({
        host, path: ROUTE_META[path] ? path : '/', title: m.title, description: m.description, noindex: !!searching,
        ld: baseLd(m.crumb ? [breadcrumbLd(host, [{ name: 'NatureGram', path: '/' }, { name: m.crumb, path }])] : []),
      });
    }
    res.status(status).type('html').send(injectShell(html, head, root));
  }

  /** For /s/:postId share cards: null when the store can't say, { public: false } when it must not show. */
  async function sharePreview(id) {
    if (!POST_ID_RE.test(String(id || ''))) return { public: false };
    const r = await loadPost(id);
    if (r.status === 'unavailable') return null;
    if (r.status !== 'ok') return { public: false };
    const c = corpusIfReady();
    const slug = slugFor(r.post, c);
    return { public: true, post: r.post, slug, ld: graph(organizationLd(host), websiteLd(host), postLd(host, r.post, { slug })) };
  }

  return { appShell, getCorpus, sharePreview };
}
