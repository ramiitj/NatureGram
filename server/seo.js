/**
 * Search and AI-answer discoverability: pure helpers (no Firestore, no Express).
 *
 *  - Slugs, escaping, the group of life a sighting belongs to (a port of services/lifeList.ts groupOf)
 *  - Privacy filtering: which sightings and explorers may appear on public, indexable pages
 *  - The public corpus: species aggregated from public sightings
 *  - JSON-LD builders (schema.org), robots.txt per AI-crawler policy, sitemap XML, llms.txt
 *
 * Privacy rules applied here, and nowhere loosened elsewhere:
 *  - Only public sightings that are not hidden, not waiting for review and not demo posts (dwc.exportable).
 *  - Never coordinates. The place is a coarse area, dropped entirely when the explorer hid it or the
 *    guide flagged a sensitive species. Any area that looks like coordinates is dropped too.
 *  - Teen explorers (ageBand 'teen') and their sightings never appear. A sighting whose author
 *    profile could not be read is left out rather than guessed about.
 *  - No emails, phone numbers or user IDs. Usernames only for non-guest profiles that are not private.
 */
import { exportable, namesOf } from './dwc.js';

export const SITE_NAME = 'NatureGram';
export const POST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const USERNAME_RE = /^[A-Za-z0-9_.-]{2,40}$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER = /^(unknown|nature|unidentified|observation|captured|uploaded|sighting|a wild sighting)\b/i;

// ------------------------------------------------------------------ text helpers
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const escapeXml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
  // XML 1.0 forbids most control characters
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** "Barn owl" -> "barn-owl", "Turdus merula" -> "turdus-merula". Mirrored in services/speciesSlug.ts. */
export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Emails and phone-like numbers out of anything an explorer typed. */
export function redactContacts(s) {
  return String(s ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/(?:\+?\d[\s().-]?){9,}\d/g, '[number removed]');
}

export const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n * 0.6)).replace(/[\s,;:.]+$/, '')}…`;
};

/** A JSON-LD script block that can't be broken out of. */
export const ldScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}</script>`;

export const toMs = (t) => (t?.toMillis ? t.toMillis() : typeof t?._seconds === 'number' ? t._seconds * 1000 : typeof t?.seconds === 'number' ? t.seconds * 1000 : typeof t === 'number' ? t : typeof t === 'string' ? (Date.parse(t) || 0) : 0);
export const isoDate = (ms) => (ms ? new Date(ms).toISOString() : undefined);
export const dayDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fieldDate = (ms) => (ms ? `${new Date(ms).getUTCDate()} ${MONTHS[new Date(ms).getUTCMonth()].slice(0, 3)} ${new Date(ms).getUTCFullYear()}` : '');
export const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export const safeHttps = (u) => {
  try { const x = new URL(String(u || '')); return x.protocol === 'https:' ? x.toString() : ''; } catch { return ''; }
};

// ------------------------------------------------------------------ groups of life (port of services/lifeList.ts)
const RX = [
  ['Fungi', /(mushroom|fung|toadstool|amanita|bolete|chanterelle|morel|agaric|russula|lactarius|cortinarius|polypore|puffball|mycena|psilocybe|galerina|lepiota|coprinus|pleurotus|bracket|lichen|mould|mold)/i],
  ['Birds', /(bird|sparrow|robin|crow|raven|jay|finch|warbler|thrush|owl|hawk|eagle|kite|falcon|kestrel|heron|egret|stork|crane|duck|goose|swan|gull|tern|pigeon|dove|parrot|parakeet|myna|starling|bulbul|kingfisher|roller|hoopoe|bee-eater|drongo|swallow|swift|martin|wren|tit\b|chickadee|woodpecker|barbet|cuckoo|koel|peacock|peafowl|pheasant|partridge|quail|sandpiper|plover|lapwing|cormorant|pelican|flamingo|ibis|vulture|magpie|oriole|sunbird|hummingbird|weaver|munia|lark|pipit|wagtail|shrike|babbler|minivet|prinia|tailorbird|flycatcher|redstart|chat\b|wheatear|nuthatch|treecreeper|grebe|coot|moorhen|rail\b|bittern|darter|coucal|hornbill|shikra|harrier|buzzard|osprey|francolin|junglefowl|fowl|rosefinch|iora|white-eye|bushchat|stonechat|jacana|stilt|avocet|curlew|godwit|snipe|loon|puffin|albatross|petrel|shearwater|frigatebird|booby|gannet|sandgrouse|nightjar|frogmouth|trogon|toucan|tanager|cardinal|grosbeak|bunting|blackbird|bluebird|mockingbird|catbird|vireo|kinglet|phoebe|pewee|kingbird|aves|passer|corvus|columba|turdus|centropus|accipiter|milvus|halcyon|ardea|egretta)/i],
  ['Insects', /(insect|butterfly|moth|bee\b|bees\b|bumblebee|honeybee|wasp|hornet|ant\b|ants\b|beetle|ladybird|ladybug|dragonfly|damselfly|grasshopper|cricket|locust|mantis|cicada|bug\b|aphid|fly\b|hoverfly|mosquito|termite|caterpillar|lepidoptera|coleoptera|odonata|hymenoptera|spider|arachnid|scorpion|centipede|millipede|tick\b|mite\b)/i],
  ['Mammals', /(mammal|squirrel|chipmunk|mouse|rat\b|vole|shrew|bat\b|bats\b|fox|wolf|jackal|dog\b|deer|antelope|gazelle|elk|moose|boar|pig\b|monkey|macaque|langur|ape|gorilla|chimp|orangutan|lemur|bear|tiger|lion|leopard|cheetah|cat\b|lynx|otter|badger|weasel|mongoose|hedgehog|rabbit|hare|elephant|rhino|hippo|giraffe|zebra|horse|cow\b|buffalo|bison|goat|sheep|ibex|camel|whale|dolphin|seal\b|sea lion|porpoise|kangaroo|wallaby|koala|possum|opossum|raccoon|skunk|beaver|porcupine|pangolin|civet|hyena|mammalia)/i],
  ['Reptiles & amphibians', /(reptile|lizard|gecko|skink|monitor|iguana|chameleon|snake|cobra|python|viper|krait|rat snake|boa|turtle|tortoise|terrapin|crocodile|alligator|gharial|frog|toad|newt|salamander|caecilian|amphibia|reptilia)/i],
  ['Water life', /(fish|carp|trout|salmon|perch|bass\b|catfish|eel|shark|ray\b|stingray|goby|minnow|guppy|koi|crab|shrimp|prawn|lobster|barnacle|jellyfish|anemone|coral|starfish|sea star|urchin|octopus|squid|cuttlefish|plankton|tadpole)/i],
  ['Plants', /(plant|tree|flower|shrub|herb|grass|fern|moss|liverwort|orchid|lily|rose|daisy|sunflower|lotus|water lily|cactus|succulent|palm|pine|fir|spruce|cedar|oak|maple|banyan|peepal|fig|neem|mango|acacia|eucalyptus|bamboo|vine|creeper|ivy|weed|clover|dandelion|poppy|tulip|jasmine|hibiscus|marigold|bougainvillea|lantana|thistle|sedge|reed|rush|algae|seaweed|leaf|leaves|blossom|bloom|seed|fruit|berry|flora|plantae|ficus|quercus|acer|pinus)/i],
  ['Other life', /(snail|slug|mollus|clam|mussel|oyster|worm|earthworm|leech|sponge)/i],
];
export const GROUPS = RX.map(r => r[0]);
export const GROUP_NOUN = {
  'Birds': 'bird', 'Plants': 'plant', 'Insects': 'insect or other small invertebrate', 'Fungi': 'fungus',
  'Mammals': 'mammal', 'Reptiles & amphibians': 'reptile or amphibian', 'Water life': 'water creature', 'Other life': 'living thing',
};

export function groupOf(p) {
  const ids = p?.aiIdentifications || p?.items?.[0]?.aiIdentifications || [];
  const hay = [...(p?.labels || []), ...(p?.tags || []), ...(Array.isArray(ids) ? ids : []).flatMap(i => [i?.commonName, i?.scientificName])]
    .filter(x => typeof x === 'string').join(' ');
  if (p?.aiFlags?.fungi) return 'Fungi';
  for (const [g, rx] of RX) if (rx.test(hay)) return g;
  return 'Other life';
}

// ------------------------------------------------------------------ privacy
/** May this profile's username appear on a public page (and get an explorer page)? */
export function publicExplorer(profile) {
  if (!profile || typeof profile !== 'object') return null;
  if (profile.isAnonymous === true || profile.ageBand === 'teen' || profile.profilePrivate === true) return null;
  const u = String(profile.username || '').trim();
  if (!USERNAME_RE.test(u) || /^explorer-[a-z0-9]{4}$/i.test(u)) return null; // fallback names carry part of the account ID
  return u;
}

/** A coarse, public area: never coordinates, at most the last two parts ("Kaziranga, Assam"). */
export function coarseArea(area) {
  const a = String(area ?? '').trim();
  if (!a || /-?\d{1,3}\.\d{2,}/.test(a) || /\d{1,3}°/.test(a)) return '';
  const parts = a.split(',').map(s => s.trim()).filter(Boolean);
  return clip(redactContacts(parts.slice(-2).join(', ')), 80);
}

const sensitive = (p) => p?.aiFlags?.sensitiveSpecies === true || (Array.isArray(p?.items) && p.items.some(i => i?.aiFlags?.sensitiveSpecies === true));

/**
 * The public face of one sighting, or null if it must not appear anywhere public.
 * profile: the author's users/{uid} data; null when the document doesn't exist; undefined when it couldn't be read.
 */
export function publicPost(id, p, profile) {
  if (!POST_ID_RE.test(String(id || ''))) return null;
  if (!exportable(id, p)) return null;
  if (profile === undefined) return null;
  if (profile && profile.ageBand === 'teen') return null;
  if (p.aiFlags?.isNatureSubject === false) return null;
  const { scientific, vernacular, rank } = namesOf(p);
  const name = vernacular && !PLACEHOLDER.test(vernacular) ? clip(vernacular, 80) : '';
  const placeOk = p.showLocation !== false && !sensitive(p);
  const main = Array.isArray(p.items) && p.items[0] ? p.items[0] : {};
  const image = safeHttps(p.imageUrl || main.imageUrl || p.thumbnailUrl || main.thumbnailUrl);
  const thumb = safeHttps(p.thumbSmallUrl || main.thumbSmallUrl || p.thumbnailUrl || main.thumbnailUrl) || image;
  const caption = clip(redactContacts(p.caption || ''), 400);
  const behaviour = String(p.behavior || '').trim();
  const observed = behaviour && !/^(captured|uploaded|recorded)\s+(photo|media|video|audio|sound)\.?$/i.test(behaviour) ? clip(redactContacts(behaviour), 300) : '';
  const tags = (Array.isArray(p.tags) ? p.tags : []).map(t => String(t || '').toLowerCase()).filter(t => /^#[a-z0-9_]{1,40}$/.test(t)).slice(0, 12);
  return {
    id,
    ms: toMs(p.timestamp),
    observedMs: toMs(p.observedAt) || toMs(p.timestamp),
    name, scientific, rank,
    group: groupOf(p),
    area: placeOk ? coarseArea(p.locationArea || main.locationArea) : '',
    image, thumb,
    mediaType: ['image', 'video', 'audio'].includes(p.mediaType) ? p.mediaType : 'image',
    caption, observed,
    insight: clip(redactContacts(p.aiInsight || main.aiInsight || ''), 400),
    title: clip(redactContacts(p.title || ''), 120),
    verified: p.communityVerified === true,
    tags,
    author: publicExplorer(profile),
    // Never published: used only for counting distinct explorers
    _uid: String(p.userId || ''),
  };
}

// ------------------------------------------------------------------ species corpus
const mostCommon = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0];
const bump = (m, k, n = 1) => { if (k) m.set(k, (m.get(k) || 0) + n); };

/**
 * Species aggregated from public sightings (output of publicPost, newest first or any order).
 * Returns { species: Map<slug, Species>, aliases: Map<slug, slug>, posts, explorers: Map<username, Explorer> }.
 */
export function buildCorpus(posts) {
  const list = posts.filter(Boolean).sort((a, b) => b.ms - a.ms);
  // A common name inherits the scientific name another sighting gave it
  const sciOf = new Map();
  for (const p of list) if (p.name && p.scientific) {
    const k = p.name.toLowerCase();
    const m = sciOf.get(k) || new Map(); bump(m, p.scientific); sciOf.set(k, m);
  }
  const species = new Map();
  const aliases = new Map();
  const explorers = new Map();
  for (const p of list) {
    const sci = p.scientific || (p.name ? mostCommon(sciOf.get(p.name.toLowerCase()) || new Map()) : '') || '';
    const slug = slugify(sci || p.name);
    if (!slug) continue;
    p.slug = slug;
    let s = species.get(slug);
    if (!s) {
      s = { slug, scientific: sci, names: new Map(), groups: new Map(), posts: [], uids: new Set(), months: new Set(), areas: new Map(), firstMs: Infinity, lastMs: 0 };
      species.set(slug, s);
    }
    bump(s.names, p.name);
    bump(s.groups, p.group);
    s.posts.push(p);
    if (p._uid) s.uids.add(p._uid);
    if (p.observedMs) s.months.add(new Date(p.observedMs).getUTCMonth());
    if (p.area) bump(s.areas, p.area);
    s.firstMs = Math.min(s.firstMs, p.observedMs || p.ms || Infinity);
    s.lastMs = Math.max(s.lastMs, p.ms || 0);
    if (p.name) aliases.set(slugify(p.name), slug);
    if (sci) aliases.set(slugify(sci), slug);
  }
  for (const s of species.values()) {
    s.name = mostCommon(s.names) || s.scientific;
    s.alternateNames = [...s.names.keys()].filter(n => n && n !== s.name).slice(0, 6);
    s.group = mostCommon(s.groups) || 'Other life';
    s.count = s.posts.length;
    s.explorers = s.uids.size;
    s.monthList = [...s.months].sort((a, b) => a - b).map(m => MONTHS[m]);
    s.regions = [...s.areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a]) => a);
    s.rank = s.scientific ? (s.scientific.split(' ').length >= 2 ? 'species' : 'genus') : '';
    if (!Number.isFinite(s.firstMs)) s.firstMs = 0;
    delete s.uids; delete s.names; delete s.groups; delete s.areas; delete s.months;
  }
  // An alias never points away from a species page that exists under its own slug
  for (const slug of species.keys()) aliases.set(slug, slug);
  for (const p of list) {
    if (!p.author) continue;
    const e = explorers.get(p.author) || { username: p.author, count: 0, species: new Set(), lastMs: 0 };
    e.count++; if (p.slug) e.species.add(p.slug); e.lastMs = Math.max(e.lastMs, p.ms || 0);
    explorers.set(p.author, e);
  }
  return { species, aliases, posts: list, explorers };
}

/** A plain-language description from our own aggregated facts. */
export function speciesSummary(s) {
  const noun = GROUP_NOUN[s.group] || 'living thing';
  const who = s.explorers > 1 ? `${s.explorers} explorers` : 'an explorer';
  const times = s.count === 1 ? 'once' : s.count === 2 ? 'twice' : `${s.count} times`;
  const parts = [`${s.name}${s.scientific && s.scientific !== s.name ? ` (${s.scientific})` : ''} is a ${noun} recorded ${times} on NatureGram by ${who}.`];
  if (s.monthList.length) parts.push(`Sightings so far fall in ${listJoin(s.monthList.length > 6 ? [...s.monthList.slice(0, 5), `${s.monthList.length - 5} other months`] : s.monthList)}.`);
  if (s.regions.length) parts.push(`Recorded around ${listJoin(s.regions.slice(0, 3))}.`);
  return parts.join(' ');
}

export function relatedSpecies(corpus, s, n = 8) {
  return [...corpus.species.values()].filter(x => x.slug !== s.slug && x.group === s.group).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, n);
}

// ------------------------------------------------------------------ JSON-LD
export const origin = (host) => `https://${host}`;

export function organizationLd(host) {
  return {
    '@type': 'Organization', '@id': `${origin(host)}/#organization`,
    name: SITE_NAME, legalName: 'Benkut Private Limited', url: `${origin(host)}/`,
    logo: { '@type': 'ImageObject', url: `${origin(host)}/icon-512.png`, width: 512, height: 512 },
    description: 'NatureGram is a field guide and community for people who love nature: a live AI naturalist helps explorers identify wild plants, animals and fungi, keep a field journal and share sightings.',
    address: { '@type': 'PostalAddress', addressCountry: 'IN' },
  };
}

export function websiteLd(host) {
  return {
    '@type': 'WebSite', '@id': `${origin(host)}/#website`, name: SITE_NAME, url: `${origin(host)}/`, inLanguage: 'en',
    publisher: { '@id': `${origin(host)}/#organization` },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin(host)}/explore?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
  };
}

export function appLd(host, { iosUrl = '', androidUrl = '' } = {}) {
  const base = {
    name: SITE_NAME, applicationCategory: 'EducationalApplication', applicationSubCategory: 'Nature identification and field journal',
    description: 'A live AI field guide and community for identifying wild species and understanding behaviour.',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@id': `${origin(host)}/#organization` },
  };
  const out = [{ '@type': 'WebApplication', '@id': `${origin(host)}/#webapp`, url: `${origin(host)}/`, operatingSystem: 'Any (web browser)', browserRequirements: 'Requires JavaScript', ...base }];
  const stores = [iosUrl && { os: 'iOS', url: iosUrl }, androidUrl && { os: 'Android', url: androidUrl }].filter(Boolean);
  if (stores.length) out.push({ '@type': 'MobileApplication', '@id': `${origin(host)}/#mobileapp`, operatingSystem: stores.map(s => s.os).join(', '), installUrl: stores.map(s => s.url), url: `${origin(host)}/`, ...base });
  return out;
}

export function breadcrumbLd(host, trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: `${origin(host)}${t.path}` })),
  };
}

export const graph = (...nodes) => ({ '@context': 'https://schema.org', '@graph': nodes.flat().filter(Boolean) });

export const speciesUrl = (host, slug) => `${origin(host)}/species/${slug}`;
export const postUrl = (host, id) => `${origin(host)}/post/${encodeURIComponent(id)}`;
export const explorerUrl = (host, u) => `${origin(host)}/explorer/${encodeURIComponent(u)}`;

export function taxonLd(host, s) {
  return {
    '@type': 'Taxon', '@id': `${speciesUrl(host, s.slug)}#taxon`,
    name: s.scientific || s.name,
    ...(s.rank ? { taxonRank: s.rank } : {}),
    alternateName: [s.scientific && s.scientific !== s.name ? s.name : null, ...s.alternateNames].filter(Boolean),
    url: speciesUrl(host, s.slug),
  };
}

export function postLd(host, p, { slug } = {}) {
  const url = postUrl(host, p.id);
  const headline = p.name || p.title || 'A wild sighting';
  const author = p.author
    ? { '@type': 'Person', name: p.author, url: explorerUrl(host, p.author) }
    : { '@type': 'Person', name: 'A NatureGram explorer' };
  const text = p.caption || p.observed || '';
  return {
    '@type': 'SocialMediaPosting', '@id': `${url}#post`, url, mainEntityOfPage: url,
    headline: clip(headline + (p.area ? `, near ${p.area}` : ''), 110),
    ...(p.ms ? { datePublished: isoDate(p.ms) } : {}),
    ...(p.observedMs && p.observedMs !== p.ms ? { dateCreated: isoDate(p.observedMs) } : {}),
    author,
    publisher: { '@id': `${origin(host)}/#organization` },
    isPartOf: { '@id': `${origin(host)}/#website` },
    ...(text ? { text } : {}),
    ...(p.image ? { image: { '@type': 'ImageObject', url: p.image, contentUrl: p.image, caption: headline, creditText: p.author || 'A NatureGram explorer' } } : {}),
    ...(p.area ? { contentLocation: { '@type': 'Place', name: p.area } } : {}),
    ...(p.name || p.scientific ? { about: { '@type': 'Taxon', name: p.scientific || p.name, ...(p.rank ? { taxonRank: p.rank } : {}), ...(p.scientific && p.name ? { alternateName: p.name } : {}), ...(slug ? { url: speciesUrl(host, slug) } : {}) } } : {}),
    ...(p.tags.length ? { keywords: p.tags.map(t => t.slice(1)).join(', ') } : {}),
  };
}

export function observationsListLd(host, s, n = 20) {
  return {
    '@type': 'ItemList', name: `Recent sightings of ${s.name} on NatureGram`, numberOfItems: s.count,
    itemListElement: s.posts.slice(0, n).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: postUrl(host, p.id), name: `${p.name || s.name}${p.area ? `, near ${p.area}` : ''}${p.ms ? `, ${dayDate(p.ms)}` : ''}` })),
  };
}

const LIFE = /^(c\.\s?)?(\d{3,4})\s*[–-]\s*(\d{4})$/;
export function personLd(host, n) {
  const m = LIFE.exec(String(n.lifespan || '').trim());
  const born = /^b\.\s?(\d{4})$/.exec(String(n.lifespan || '').trim());
  return {
    '@type': 'Person', '@id': `${origin(host)}/naturalists/${n.id}#person`, name: n.naturalist,
    ...(m ? { birthDate: m[2], deathDate: m[3] } : born ? { birthDate: born[1] } : {}),
    ...(n.bio ? { description: n.bio } : {}),
    ...(n.wiki ? { sameAs: [n.wiki] } : {}),
    knowsAbout: 'Natural history',
  };
}

export function faqLd(faqs) {
  return { '@type': 'FAQPage', mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
}

// ------------------------------------------------------------------ robots.txt
// Crawlers that gather text for training models, and crawlers that fetch pages to answer or cite
// them in AI search. Google's AI Overviews use Googlebot itself, so they follow the normal rules.
export const AI_TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'meta-externalagent', 'cohere-training-data-crawler'];
export const AI_SEARCH_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'Claude-SearchBot', 'Claude-User', 'DuckAssistBot'];
// App-only and private areas: never useful in search
export const PRIVATE_PATHS = ['/admin', '/messages', '/review', '/lens', '/drafts', '/auth/', '/guardian', '/welcome', '/journal', '/api/', '/api-proxy'];
export const PUBLIC_API_ALLOW = ['/api/feed/first', '/api/client-config'];

export const aiCrawlerMode = (v) => (['allow', 'search-only', 'deny'].includes(String(v || '').trim().toLowerCase()) ? String(v).trim().toLowerCase() : 'allow');

export function robotsTxt({ host, mode = 'allow' }) {
  const m = aiCrawlerMode(mode);
  const rules = [...PUBLIC_API_ALLOW.map(p => `Allow: ${p}`), ...PRIVATE_PATHS.map(p => `Disallow: ${p}`)];
  const group = (agents, body) => [...agents.map(a => `User-agent: ${a}`), ...body, ''].join('\n');
  const out = [
    `# robots.txt for ${host}`,
    `# AI crawler policy: ${m} (set with AI_CRAWLERS=allow|search-only|deny; see docs/SEO.md)`,
    '',
    group(['*'], ['Allow: /', ...rules]),
  ];
  const open = ['Allow: /', ...rules];
  const shut = ['Disallow: /'];
  if (m === 'allow') {
    out.push('# AI answer engines and model crawlers: welcome to the public field guide');
    out.push(group([...AI_SEARCH_BOTS, ...AI_TRAINING_BOTS], open));
  } else if (m === 'search-only') {
    out.push('# AI search and citation: allowed');
    out.push(group(AI_SEARCH_BOTS, open));
    out.push('# Model training: not allowed');
    out.push(group(AI_TRAINING_BOTS, shut));
  } else {
    out.push('# AI crawlers: not allowed (normal search engines still are)');
    out.push(group([...AI_SEARCH_BOTS, ...AI_TRAINING_BOTS], shut));
  }
  out.push(`Sitemap: ${origin(host)}/sitemap.xml`, '');
  return out.join('\n');
}

// ------------------------------------------------------------------ sitemaps
export function sitemapIndexXml(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `  <sitemap><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : ''}</sitemap>`).join('\n')}
</sitemapindex>
`;
}

export function urlsetXml(entries) {
  const img = entries.some(e => e.images?.length);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${img ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ''}>
${entries.map(e => `  <url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : ''}${(e.images || []).slice(0, 5).map(i => `<image:image><image:loc>${escapeXml(i)}</image:loc></image:image>`).join('')}</url>`).join('\n')}
</urlset>
`;
}

// ------------------------------------------------------------------ the about page's questions
export const FAQS = [
  { q: 'What is NatureGram?', a: 'NatureGram is a field guide and community for people who love nature. Point your camera at a wild plant, animal or fungus and a live AI naturalist, called the guide, suggests what it might be and why it behaves the way it does. Explorers keep a private field journal and can share sightings with explorers around the world.' },
  { q: 'Is NatureGram free?', a: 'Yes. NatureGram is free to use and asks for no payment details. Everyone gets the same daily allowance of identifications, live guide minutes and shared sightings, which resets at midnight UTC. You can look around as a guest; sharing sightings needs a free account.' },
  { q: 'How does identification work?', a: 'The guide, built on Google Gemini models, proposes a name with a confidence level and the evidence it used, such as field marks. When it is unsure it says so and names a broader group instead of guessing. You review the suggestion and decide what to publish. Other explorers can agree with an identification or suggest another; when two or more agree, the sighting is marked community verified, and majority disagreement marks it disputed.' },
  { q: 'How accurate is it, and how is the AI governed?', a: 'Identifications are suggestions and can be wrong, so every AI output is labelled as the guide\'s suggestion with its confidence. Low-confidence sightings are opened to community review, and captures the live guide makes are checked by a second model. The guide never advises on eating or handling wild organisms: never eat, touch or handle anything based on an identification. No AI-generated imagery is allowed in observation records. Models and prompts are versioned, audited and reversible, following the NIST AI Risk Management Framework.' },
  { q: 'Does NatureGram share my location?', a: 'Exact coordinates are never shown to anyone else; they stay private in your account. A sighting shows only an approximate area, such as a town or park, and you can hide it on any sighting. The area is always hidden for sensitive or protected species, and the AI never infers or states locations. Photos are checked for people, faces, number plates and screens before they are shared.' },
  { q: 'Can teenagers use NatureGram?', a: 'NatureGram is for explorers aged 13 and over. Explorers aged 13 to 17 need a parent or guardian\'s verifiable consent before anything they record can be shared. In teen mode there is no advertising or analytics, the place of a sighting is never shown, and teen explorers are left out of search. NatureGram\'s public pages and sitemaps never list teen explorers or their sightings.' },
  { q: 'Who owns the photos and notes?', a: 'Explorers keep ownership of what they post. NatureGram displays public sightings in the app, on these public field guide pages and in share previews. Deleting a sighting removes it from NatureGram.' },
  { q: 'Who runs NatureGram?', a: 'NatureGram is operated by Benkut Private Limited, a company incorporated in India. The privacy policy and terms of use explain what is collected, why, and your rights.' },
  { q: 'How should I cite NatureGram?', a: 'Link to the page you used. Species pages (thenaturegram.com/species/…) summarise public community sightings; observation pages (thenaturegram.com/post/…) are individual records credited to the explorer who shared them. Identifications are community observations aided by AI, not expert-verified records unless marked community verified.' },
];

// ------------------------------------------------------------------ llms.txt
export function llmsTxt({ host, corpus, naturalists, full = false }) {
  const o = origin(host);
  const lines = [
    '# NatureGram',
    '',
    '> NatureGram is a free field guide and nature community. A live AI naturalist ("the guide") helps explorers identify wild plants, animals and fungi from their camera, and explorers keep a field journal and share sightings. Public pages summarise community sightings by species, with coarse places only.',
    '',
    'NatureGram is operated by Benkut Private Limited (India). Identifications are AI-assisted community observations: the guide proposes a name with a confidence level, the explorer decides what to publish, and other explorers can confirm or dispute it ("community verified" means two or more agreed). Exact locations are never published; places are approximate areas and are withheld for sensitive species. Teen explorers and their sightings never appear on public pages.',
    '',
    '## Key pages',
    '',
    `- [About NatureGram and FAQ](${o}/about): what NatureGram is, cost, how identification and AI governance work, privacy and teens`,
    `- [Species index](${o}/species): every species with public sightings, grouped by kind of life`,
    `- [Naturalists of the fortnight](${o}/naturalists): the famous naturalist featured every 15 days, with their field challenge`,
    `- [Explore](${o}/explore): search sightings in the app (${o}/explore?q=owl)`,
    `- [Privacy policy](${o}/privacy.html)`,
    `- [Terms of use](${o}/terms.html)`,
    '',
    '## How to cite',
    '',
    `- Cite a species page (${o}/species/<slug>) for aggregated facts: number of sightings, months recorded and regions.`,
    `- Cite an observation page (${o}/post/<id>) for a single record, credited to the explorer's username shown on it.`,
    '- Say that identifications are AI-assisted community observations unless the page marks them community verified.',
    '- Do not infer precise locations; the places shown are deliberately approximate.',
    '',
  ];
  const species = corpus ? [...corpus.species.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) : [];
  if (species.length) {
    lines.push('## Species', '');
    const top = full ? species : species.slice(0, 50);
    if (full) {
      for (const g of GROUPS) {
        const inG = top.filter(s => s.group === g);
        if (!inG.length) continue;
        lines.push(`### ${g}`, '');
        for (const s of inG) lines.push(`- [${s.name}${s.scientific && s.scientific !== s.name ? ` (${s.scientific})` : ''}](${speciesUrl(host, s.slug)}): ${speciesSummary(s)}`);
        lines.push('');
      }
    } else {
      for (const s of top) lines.push(`- [${s.name}${s.scientific && s.scientific !== s.name ? ` (${s.scientific})` : ''}](${speciesUrl(host, s.slug)}): ${s.count} ${s.count === 1 ? 'sighting' : 'sightings'}, ${GROUP_NOUN[s.group]}`);
      if (species.length > top.length) lines.push(`- [All ${species.length} species](${o}/species)`);
      lines.push('');
    }
  }
  if (naturalists?.length) {
    lines.push('## Naturalists', '');
    for (const n of naturalists) lines.push(`- [${n.naturalist}](${o}/naturalists/${n.id})${full ? `: ${[n.lifespan, n.bio, n.philosophy ? `Philosophy: ${n.philosophy}` : '', n.challenge ? `Field challenge: ${n.challenge}` : ''].filter(Boolean).join(' ')}` : ''}`);
    lines.push('');
  }
  if (full) {
    lines.push('## Frequently asked questions', '');
    for (const f of FAQS) lines.push(`### ${f.q}`, '', f.a, '');
  } else {
    lines.push('## Optional', '', `- [Full text for language models](${o}/llms-full.txt): every species, naturalist biographies and the FAQ in one file`, '');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ naturalists
export const WIKI_OVERRIDES = { wilson: 'E._O._Wilson' };
export const wikiUrl = (n) => `https://en.wikipedia.org/wiki/${WIKI_OVERRIDES[n.id] || encodeURIComponent(String(n.naturalist).replace(/ /g, '_')).replace(/%2C/g, ',')}`;

/** The days of the year a naturalist is featured (matches getThemePeriod in constants/naturalistExtras.ts). */
export function featuredWindow(index, year = new Date().getUTCFullYear(), total = 24) {
  const PERIOD = 15.21;
  const startDay = Math.max(1, Math.ceil(index * PERIOD));
  const endDay = Math.min(Math.ceil((index + 1) * PERIOD) - 1, index === total - 1 ? 366 : 365);
  const d = (day) => new Date(Date.UTC(year, 0, day));
  return { start: d(startDay), end: d(endDay) };
}
/** The fortnight naturalists with their extras (from the app's constants, shipped as JSON). */
export function mergeNaturalists(themes, extras) {
  return (Array.isArray(themes) ? themes : []).filter(t => t && /^[a-z]{2,20}$/.test(String(t.id || ''))).map(t => {
    const x = (extras && extras[t.id]) || {};
    const n = {
      id: t.id, naturalist: String(t.naturalist || ''), quote: String(t.quote || ''), locationName: String(t.locationName || ''), locationCaption: String(t.locationCaption || ''),
      lifespan: String(x.lifespan || ''), bio: String(x.bio || ''), philosophy: String(x.philosophy || ''),
      challenge: String(x.challenge || 'Share one thing in nature that surprised you this week.'),
      challengeTag: String(x.challengeTag || '#NatureGram'), lensPrompt: String(x.lensPrompt || ''),
    };
    n.wiki = wikiUrl(n);
    return n;
  });
}

export const currentNaturalistIndex = (now = new Date(), total = 24) => {
  const day = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000);
  return Math.floor(day / 15.21) % total;
};
