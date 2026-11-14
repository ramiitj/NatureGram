/**
 * Server-rendered public pages: plain HTML a crawler or an AI answer engine can read without
 * JavaScript. No client script at all; each page carries one link into the app.
 * Every value from the store is escaped (escapeHtml) or serialised by ldScript.
 */
import { naturalistAt } from './brandIcon.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROTATION = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../constants/palettes.json'), 'utf8'));
import {
  escapeHtml as e, ldScript, graph, organizationLd, websiteLd, breadcrumbLd, taxonLd, observationsListLd, personLd, faqLd, postLd,
  speciesSummary, relatedSpecies, fieldDate, GROUPS, GROUP_NOUN, FAQS, origin, clip, featuredWindow, isoDate,
} from './seo.js';

const FONTS = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&family=Inter:wght@400;500;600&display=swap';
// The same mark as the app and the browser tab: the disc in the fortnight's colours, drawn by the server
const MARK = '<img src="/brand/mark.svg" alt="" width="24" height="24">';

/** The fortnight's accent (contrast-tested on cream, constants/palettes.json), so these pages follow the theme too. */
const accentNow = () => {
  try { const p = ROTATION.palettes[naturalistAt()]; return /^#[0-9a-f]{6}$/i.test(p?.accent || '') ? p.accent : null; } catch { return null; }
};

const CSS = `:root{--bg:#fcfaf8;--paper:#f3efe7;--rule:#e7e5e4;--ink:#1c1917;--text:#44403c;--muted:#78716c;--accent:#57534e}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.65;padding:0 24px 48px}
.wrap{max-width:760px;margin:0 auto}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:24px 0 16px}
.mark{display:inline-flex;align-items:center;gap:10px;min-height:44px;color:var(--ink);text-decoration:none;font-family:"Newsreader",Georgia,serif;font-style:italic;font-size:22px;font-weight:400;letter-spacing:-.01em}
.mark img{width:24px;height:24px;border-radius:50%;flex-shrink:0}
nav.site a{color:var(--text);text-decoration:none;font-size:14px;margin-left:20px;display:inline-flex;min-height:44px;align-items:center}nav.site a:hover{color:var(--ink);text-decoration:underline;text-underline-offset:6px}
.crumbs{font-size:12px;color:var(--muted);margin:8px 0 24px}.crumbs a{color:var(--muted)}
.page{padding:0}
.frame{padding:8px 0 0}
h1,h2,h3{font-family:"Newsreader",Georgia,serif;color:var(--ink);font-weight:400;line-height:1.2;letter-spacing:-.01em}
h1{font-size:40px;line-height:1.12;margin:0 0 6px}h2{font-size:20px;margin:40px 0 12px;padding-top:24px;border-top:1px solid var(--rule)}h3{font-size:20px;margin:0}
h2:before{content:"";display:block;width:32px;height:1px;background:var(--accent);margin-bottom:16px}
.sp{font-style:italic}.sci{font-family:"Newsreader",Georgia,serif;font-style:italic;color:var(--muted);margin:0 0 4px;font-size:20px}
.kind{font-size:14px;color:var(--muted);margin:0}
p.lede{font-family:"Newsreader",Georgia,serif;font-size:20px;line-height:1.5;color:var(--text);max-width:65ch}
dl.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0;margin:24px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
dl.facts div{padding:12px 16px 12px 0}
dl.facts dt{font-size:12px;color:var(--muted)}dl.facts dd{margin:0;font-family:"Newsreader",Georgia,serif;font-size:20px;color:var(--ink)}
.note{border-left:1px solid var(--accent);margin:24px 0;padding:2px 0 2px 20px;color:var(--text);font-family:"Newsreader",Georgia,serif;font-style:italic;font-size:18px}
.note small{display:block;font-family:"Inter",system-ui,sans-serif;font-style:normal;font-size:12px;color:var(--muted);margin-top:6px}
ul.plates{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:24px 16px}
ul.plates li{padding:0}
ul.plates a{text-decoration:none;color:inherit;display:block}
ul.plates img{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:var(--paper);border-radius:6px}
ul.plates .cap{font-size:12px;color:var(--muted);margin-top:10px;line-height:1.5}
ul.plates .cap b{display:block;font-family:"Newsreader",Georgia,serif;font-style:italic;font-weight:400;font-size:16px;color:var(--ink)}
ul.names{list-style:none;padding:0;margin:0;columns:2 220px;column-gap:32px}
ul.names li{break-inside:avoid;padding:8px 0;border-bottom:1px solid var(--rule)}ul.names a{color:var(--ink);font-family:"Newsreader",Georgia,serif;font-style:italic;font-size:18px;text-decoration:none}
ul.names a:hover{text-decoration:underline;text-decoration-color:var(--accent);text-underline-offset:5px}
ul.names .n{color:var(--muted);font-size:12px;font-family:"Inter",system-ui,sans-serif;font-style:normal}
blockquote{margin:24px 0;font-family:"Newsreader",Georgia,serif;font-style:italic;font-size:28px;line-height:1.2;color:var(--ink)}
blockquote footer{font-style:normal;font-family:"Inter",system-ui,sans-serif;font-size:14px;color:var(--muted);margin-top:12px}
dl.faq dt{font-family:"Newsreader",Georgia,serif;font-size:20px;color:var(--ink);margin-top:28px}dl.faq dd{margin:8px 0 0;max-width:65ch}
a{color:var(--ink);text-decoration-color:var(--accent);text-underline-offset:4px}
a.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:0 24px;border-radius:999px;background:var(--ink);color:#fff;text-decoration:none;font-weight:600;font-size:15px;margin-top:32px}
a.btn:after{content:"\\2192";color:#a8a29e}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
section.team{margin:0}
.people{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:28px;margin-top:20px}
.person h3{font-family:"Newsreader",Georgia,serif;font-weight:400;font-size:24px;line-height:1.2;color:var(--ink);margin:0}
.person .role{font-size:14px;color:#78716c;margin:4px 0 0}
.person .line{font-family:"Newsreader",Georgia,serif;font-style:italic;font-size:19px;color:var(--ink);margin:14px 0 6px}
.person p{margin:0 0 8px;max-width:60ch}
.person a.in{display:inline-flex;align-items:center;gap:6px;min-height:44px;color:var(--ink);text-underline-offset:4px}
a.btn:hover{background:#292524}a:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:6px}
footer.site{font-size:12px;color:var(--muted);margin-top:48px;padding-top:24px;border-top:1px solid var(--rule);text-align:center}footer.site a{color:var(--muted);margin:0 8px}
@media (max-width:480px){h1{font-size:28px}nav.site a{margin-left:12px}}`;

/**
 * opts: { host, path, title, description, image, imageAlt, imageSize:[w,h], type, ld, noindex, body, crumbs:[{name,path}] }
 */
export function layout(o) {
  const url = `${origin(o.host)}${o.path}`;
  const image = o.image || `${origin(o.host)}/og-default.jpg?v=2`;
  const size = o.image ? o.imageSize : [1200, 630];
  const crumbs = o.crumbs?.length > 1
    ? `<nav class="crumbs" aria-label="Breadcrumb">${o.crumbs.map((c, i) => (i < o.crumbs.length - 1 ? `<a href="${e(c.path)}">${e(c.name)}</a> › ` : `<span aria-current="page">${e(c.name)}</span>`)).join('')}</nav>`
    : '';
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(o.title)}</title>
<meta name="description" content="${e(o.description)}">
<link rel="canonical" href="${e(url)}">
${o.noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">'}
<meta property="og:type" content="${e(o.type || 'website')}"><meta property="og:site_name" content="NatureGram"><meta property="og:locale" content="en_GB">
<meta property="og:url" content="${e(url)}"><meta property="og:title" content="${e(o.title)}"><meta property="og:description" content="${e(o.description)}">
<meta property="og:image" content="${e(image)}"><meta property="og:image:alt" content="${e(o.imageAlt || o.title)}">${size ? `<meta property="og:image:width" content="${size[0]}"><meta property="og:image:height" content="${size[1]}">` : ''}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(o.title)}"><meta name="twitter:description" content="${e(o.description)}"><meta name="twitter:image" content="${e(image)}">
<meta name="theme-color" content="#fcfaf8">
<link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${FONTS}" rel="stylesheet">
<style>${CSS}${accentNow() ? `:root{--accent:${accentNow()}}` : ''}</style>
${o.ld ? ldScript(o.ld) : ''}
</head><body><div class="wrap">
<header class="top"><a class="mark" href="/">${MARK}NatureGram</a><nav class="site" aria-label="Field guide"><a href="/species">Species</a><a href="/naturalists">Naturalists</a><a href="/about">About</a></nav></header>
${crumbs}
<main class="page"><div class="frame">
${o.body}
</div></main>
<footer class="site"><a href="/">NatureGram</a><a href="/about">About</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></footer>
</div></body></html>`;
}

const crumbLd = (host, crumbs) => breadcrumbLd(host, crumbs);
const plate = (p, fallbackName, nameless = false) => {
  const name = p.name || fallbackName || 'A wild sighting';
  const meta = [fieldDate(p.observedMs || p.ms), p.area ? `near ${p.area}` : '', p.author ? `by ${p.author}` : ''].filter(Boolean).join(' · ');
  return `<li><a href="/post/${encodeURIComponent(p.id)}">${p.thumb ? `<img src="${e(p.thumb)}" alt="${e(`${name}${p.area ? `, near ${p.area}` : ''}`)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="300" height="300">` : ''}<div class="cap">${nameless && !p.name ? '' : `<b>${e(name)}</b>`}${e(meta)}${p.verified ? '<br>Community verified' : ''}</div></a></li>`;
};

// ------------------------------------------------------------------ species
export function speciesPage({ host, corpus, s }) {
  const crumbs = [{ name: 'NatureGram', path: '/' }, { name: 'Species', path: '/species' }, { name: s.name, path: `/species/${s.slug}` }];
  const summary = speciesSummary(s);
  const related = relatedSpecies(corpus, s);
  const withPhoto = s.posts.filter(p => p.thumb);
  const insightPost = s.posts.find(p => p.insight && p.verified) || s.posts.find(p => p.insight);
  const cover = withPhoto[0];
  const title = `${s.name}${s.scientific && s.scientific !== s.name ? ` (${s.scientific})` : ''}: sightings and field notes · NatureGram`;
  const ld = graph(
    organizationLd(host), websiteLd(host), crumbLd(host, crumbs),
    {
      '@type': 'WebPage', '@id': `${origin(host)}/species/${s.slug}`, url: `${origin(host)}/species/${s.slug}`, name: title, description: summary,
      isPartOf: { '@id': `${origin(host)}/#website` }, about: { '@id': `${origin(host)}/species/${s.slug}#taxon` },
      ...(s.lastMs ? { dateModified: isoDate(s.lastMs) } : {}),
      ...(cover ? { primaryImageOfPage: { '@type': 'ImageObject', url: cover.image || cover.thumb } } : {}),
    },
    taxonLd(host, s), observationsListLd(host, s),
  );
  const body = `
<p class="kind">${e(s.group)}</p>
<h1 class="sp">${e(s.name)}</h1>
${s.scientific && s.scientific !== s.name ? `<p class="sci">${e(s.scientific)}</p>` : ''}
${s.alternateNames.length ? `<p class="kind">Also recorded as ${e(s.alternateNames.join(', '))}</p>` : ''}
<p class="lede">${e(summary)}</p>
<dl class="facts">
<div><dt>Sightings</dt><dd>${s.count}</dd></div>
<div><dt>Explorers</dt><dd>${s.explorers}</dd></div>
<div><dt>Months recorded</dt><dd>${s.monthList.length || '–'}</dd></div>
${s.firstMs ? `<div><dt>First recorded</dt><dd>${e(fieldDate(s.firstMs))}</dd></div>` : ''}
</dl>
${insightPost ? `<div class="note">${e(insightPost.insight)}<small>The guide's note on <a href="/post/${encodeURIComponent(insightPost.id)}">one recent sighting</a>: an AI suggestion that explorers can confirm or correct.</small></div>` : ''}
${withPhoto.length ? `<h2>Recent sightings</h2><p class="kind">Places are approximate areas, never exact spots, and hidden for sensitive species.</p><ul class="plates">${withPhoto.slice(0, 12).map(p => plate({ ...p, name: p.name && p.name !== s.name ? p.name : '' }, '', true)).join('')}</ul>` : ''}
${related.length ? `<h2>Other ${e(s.group.toLowerCase())} on NatureGram</h2><ul class="names">${related.map(r => `<li><a href="/species/${r.slug}">${e(r.name)}</a> <span class="n">${r.count}</span></li>`).join('')}</ul>` : ''}
<a class="btn" href="/explore?q=${encodeURIComponent(s.name)}">Look for ${e(s.name)} in NatureGram</a>`;
  return layout({
    host, path: `/species/${s.slug}`, title, description: clip(summary, 300), crumbs, ld, body, type: 'article',
    image: cover?.image || cover?.thumb, imageAlt: s.name, noindex: !s.indexable,
  });
}

export function speciesIndexPage({ host, corpus }) {
  const crumbs = [{ name: 'NatureGram', path: '/' }, { name: 'Species', path: '/species' }];
  const all = corpus ? [...corpus.species.values()] : [];
  const sections = GROUPS.map(g => {
    const list = all.filter(s => s.group === g).sort((a, b) => a.name.localeCompare(b.name));
    return list.length ? `<h2 id="${e(g.toLowerCase().replace(/[^a-z]+/g, '-'))}">${e(g)}</h2><ul class="names">${list.map(s => `<li><a href="/species/${s.slug}">${e(s.name)}</a> <span class="n">${s.count}</span></li>`).join('')}</ul>` : '';
  }).join('');
  const description = `A field guide to the ${all.length} wild species explorers have recorded and shared on NatureGram, grouped by kind of life.`;
  const ld = graph(organizationLd(host), websiteLd(host), crumbLd(host, crumbs), {
    '@type': 'CollectionPage', '@id': `${origin(host)}/species`, url: `${origin(host)}/species`, name: 'Species on NatureGram', description, isPartOf: { '@id': `${origin(host)}/#website` },
    mainEntity: { '@type': 'ItemList', numberOfItems: all.length, itemListElement: all.sort((a, b) => b.count - a.count).slice(0, 100).map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin(host)}/species/${s.slug}`, name: s.name })) },
  });
  const body = `<h1>Species on NatureGram</h1>
<p class="lede">${e(description)} Each page gathers the public sightings of one species: when and roughly where it was seen, and photos from the explorers who found it.</p>
${sections || '<p>No public sightings yet. Be the first to share one.</p>'}
<a class="btn" href="/explore">Explore sightings in NatureGram</a>`;
  return layout({ host, path: '/species', title: 'Species field guide: wild plants, animals and fungi · NatureGram', description, crumbs, ld, body });
}

// ------------------------------------------------------------------ naturalists
export function naturalistPage({ host, list, index, answers, current }) {
  const n = list[index];
  const crumbs = [{ name: 'NatureGram', path: '/' }, { name: 'Naturalists', path: '/naturalists' }, { name: n.naturalist, path: `/naturalists/${n.id}` }];
  const win = featuredWindow(index, new Date().getUTCFullYear(), list.length);
  const fmt = (d) => `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
  const prev = list[(index - 1 + list.length) % list.length];
  const next = list[(index + 1) % list.length];
  const description = clip(`${n.naturalist}${n.lifespan ? ` (${n.lifespan})` : ''}: ${n.bio} Their field challenge on NatureGram: ${n.challenge}`, 300);
  const ld = graph(organizationLd(host), websiteLd(host), crumbLd(host, crumbs), personLd(host, n), {
    '@type': 'ProfilePage', '@id': `${origin(host)}/naturalists/${n.id}`, url: `${origin(host)}/naturalists/${n.id}`, name: `${n.naturalist} · NatureGram`,
    mainEntity: { '@id': `${origin(host)}/naturalists/${n.id}#person` }, isPartOf: { '@id': `${origin(host)}/#website` },
  });
  const body = `<p class="kind">Naturalist of the fortnight${current ? ', featured now' : ''}</p>
<h1>${e(n.naturalist)}</h1>
${n.lifespan ? `<p class="sci">${e(n.lifespan)}</p>` : ''}
<blockquote>“${e(n.quote)}”</blockquote>
${n.bio ? `<p class="lede">${e(n.bio)}</p>` : ''}
${n.philosophy ? `<h2>Their way of seeing</h2><p>${e(n.philosophy)}</p>` : ''}
${n.locationName ? `<h2>Where they worked</h2><p><strong>${e(n.locationName)}</strong>. ${e(n.locationCaption || '')}</p>` : ''}
<h2>The field challenge</h2>
<p>${e(n.challenge)} Sightings that answer it are marked <strong>${e(n.challengeTag)}</strong> automatically.</p>
<p class="kind">Featured each year from ${e(fmt(win.start))} to ${e(fmt(win.end))}, when NatureGram's colours and the guide's focus follow ${e(n.naturalist)}.</p>
${answers.length ? `<h2>Community answers</h2><ul class="plates">${answers.slice(0, 12).map(p => plate(p)).join('')}</ul>` : ''}
<p><a href="/naturalists/${e(prev.id)}">← ${e(prev.naturalist)}</a> · <a href="/naturalists/${e(next.id)}">${e(next.naturalist)} →</a></p>
<a class="btn" href="/explore">Take the challenge in NatureGram</a>`;
  return layout({ host, path: `/naturalists/${n.id}`, title: `${n.naturalist}${n.lifespan ? ` (${n.lifespan})` : ''}: life, philosophy and field challenge · NatureGram`, description, crumbs, ld, body, type: 'profile' });
}

export function naturalistsIndexPage({ host, list, currentIndex }) {
  const crumbs = [{ name: 'NatureGram', path: '/' }, { name: 'Naturalists', path: '/naturalists' }];
  const description = `Every 15 days NatureGram honours one of ${list.length} naturalists, from Charles Darwin to Wangari Maathai: the app's colours, the guide's focus and a community field challenge follow their way of seeing.`;
  const ld = graph(organizationLd(host), websiteLd(host), crumbLd(host, crumbs), {
    '@type': 'CollectionPage', '@id': `${origin(host)}/naturalists`, url: `${origin(host)}/naturalists`, name: 'Naturalists of the fortnight', description,
    mainEntity: { '@type': 'ItemList', numberOfItems: list.length, itemListElement: list.map((n, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin(host)}/naturalists/${n.id}`, name: n.naturalist })) },
  });
  const body = `<h1>Naturalists of the fortnight</h1>
<p class="lede">${e(description)}</p>
<ul class="names">${list.map((n, i) => `<li><a href="/naturalists/${e(n.id)}">${e(n.naturalist)}</a> <span class="n">${e(n.lifespan || '')}${i === currentIndex ? ' · featured now' : ''}</span></li>`).join('')}</ul>
<a class="btn" href="/explore">See this fortnight's challenge in NatureGram</a>`;
  return layout({ host, path: '/naturalists', title: 'Naturalists of the fortnight · NatureGram', description, crumbs, ld, body });
}

// ------------------------------------------------------------------ explorers
export function explorerPage({ host, username, bio, posts, corpus }) {
  const crumbs = [{ name: 'NatureGram', path: '/' }, { name: username, path: `/explorer/${encodeURIComponent(username)}` }];
  const slugs = new Map();
  for (const p of posts) {
    const key = p.slug || (p.name || p.scientific || '').toLowerCase();
    if (key && !slugs.has(key)) slugs.set(key, { slug: p.slug && corpus?.species.has(p.slug) ? p.slug : null, name: p.name || p.scientific });
  }
  const speciesList = [...slugs.values()].filter(s => s.name);
  const description = `${username}'s field page on NatureGram: ${posts.length} public ${posts.length === 1 ? 'sighting' : 'sightings'} of ${speciesList.length} ${speciesList.length === 1 ? 'species' : 'species'}.`;
  const cover = posts.find(p => p.thumb);
  const url = `${origin(host)}/explorer/${encodeURIComponent(username)}`;
  const ld = graph(organizationLd(host), websiteLd(host), crumbLd(host, crumbs), {
    '@type': 'ProfilePage', '@id': url, url, name: `${username} · NatureGram`, isPartOf: { '@id': `${origin(host)}/#website` },
    mainEntity: { '@type': 'Person', '@id': `${url}#person`, name: username, alternateName: username, url, ...(bio ? { description: bio } : {}) },
    ...(posts[0]?.ms ? { dateModified: isoDate(posts[0].ms) } : {}),
  });
  const body = `<p class="kind">An explorer's field page</p>
<h1>${e(username)}</h1>
${bio ? `<p class="lede">${e(bio)}</p>` : ''}
<dl class="facts"><div><dt>Public sightings</dt><dd>${posts.length}</dd></div><div><dt>Species</dt><dd>${speciesList.length}</dd></div>${posts[0]?.ms ? `<div><dt>Latest</dt><dd>${e(fieldDate(posts[0].ms))}</dd></div>` : ''}</dl>
${posts.some(p => p.thumb) ? `<h2>Recent sightings</h2><ul class="plates">${posts.filter(p => p.thumb).slice(0, 18).map(p => plate({ ...p, author: null })).join('')}</ul>` : ''}
${speciesList.length ? `<h2>Species recorded</h2><ul class="names">${speciesList.slice(0, 60).map(s => `<li>${s.slug ? `<a href="/species/${s.slug}">${e(s.name)}</a>` : `<span class="sp">${e(s.name)}</span>`}</li>`).join('')}</ul>` : ''}
<a class="btn" href="/explore">Open NatureGram</a>`;
  return layout({ host, path: `/explorer/${encodeURIComponent(username)}`, title: `${username}: sightings and life list · NatureGram`, description, crumbs, ld, body, type: 'profile', image: cover?.image || cover?.thumb, imageAlt: cover?.name });
}

// ------------------------------------------------------------------ about
/** The people behind NatureGram (shown on /about, and as founders in the page's structured data). */
export const TEAM = [
  {
    name: 'Roshini Ganuthula',
    role: 'Co-founder · design and product',
    linkedin: 'https://www.linkedin.com/in/roshiniganuthula',
    line: 'Shapes how NatureGram looks, sounds and feels.',
    bio: 'Designer and researcher, trained in economics and communication design. Product work across healthcare, climate tech and edtech in India, the US and the UAE. Guest lecturer at IIT Bombay and IIT Jodhpur.',
  },
  {
    name: 'Venkat Ram Reddy Ganuthula',
    role: 'Co-founder · research and build',
    linkedin: 'https://www.linkedin.com/in/ganuthula',
    line: 'Studies behaviour, builds with AI.',
    bio: 'Faculty at IIT Jodhpur, teaching and studying the behaviour of AI agents. Has built eight AI apps end to end. Thoreauvian at heart, he built NatureGram out of a lifelong love of nature and its small wonders.',
  },
];
export const CONTACT_EMAIL = 'ramganuthula@gmail.com';

export function aboutPage({ host, appLdNodes }) {
  const crumbs = [{ name: 'NatureGram', path: '/' }, { name: 'About', path: '/about' }];
  const description = 'What NatureGram is, whether it is free, how AI identification and community verification work, and how location privacy and teen protections work.';
  const ld = graph(organizationLd(host), websiteLd(host), appLdNodes, crumbLd(host, crumbs), faqLd(FAQS), {
    '@type': 'AboutPage', '@id': `${origin(host)}/about`, url: `${origin(host)}/about`, name: 'About NatureGram', description, isPartOf: { '@id': `${origin(host)}/#website` }, about: { '@id': `${origin(host)}/#organization` },
  }, ...TEAM.map(t => ({ '@type': 'Person', name: t.name, jobTitle: t.role.replace(/^Co-founder · /, 'Co-founder, '), sameAs: [t.linkedin], worksFor: { '@id': `${origin(host)}/#organization` } })));
  const body = `<h1>About NatureGram</h1>
<p class="lede">${e(FAQS[0].a)}</p>
<section class="team" aria-labelledby="who">
<h2 id="who">Who we are</h2>
<p>NatureGram is made by two people who love being outside and noticing what lives there.</p>
<div class="people">${TEAM.map(t => `<article class="person">
<h3>${e(t.name)}</h3>
<p class="role">${e(t.role)}</p>
<p class="line">${e(t.line)}</p>
<p>${e(t.bio)}</p>
<a class="in" href="${e(t.linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn: ${e(t.linkedin.replace(/^https:\/\/www\./, ''))} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>
</article>`).join('')}</div>
<p style="margin-top:24px">Questions, ideas or a problem to report? Write to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
</section>
<h2>Questions people ask</h2>
<dl class="faq">${FAQS.slice(1).map(f => `<dt>${e(f.q)}</dt><dd>${e(f.a)}</dd>`).join('')}</dl>
<a class="btn" href="/">Open NatureGram</a>`;
  return layout({ host, path: '/about', title: 'About NatureGram: free AI field guide and nature community', description, crumbs, ld, body });
}

// ------------------------------------------------------------------ a page that isn't available right now
export function unavailablePage({ host, path }) {
  return layout({
    host, path, noindex: true, title: 'Back in a moment · NatureGram', description: 'The field guide is unavailable for a moment.',
    body: '<h1>Back in a moment</h1><p class="lede">The field guide is resting. Please try again shortly.</p><a class="btn" href="/">Open NatureGram</a>',
  });
}

// ------------------------------------------------------------------ head and fallback content for the app's own pages
export function postFallbackBody(p, slug) {
  const name = p.name || p.title || 'A wild sighting';
  return `<article style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:Newsreader,Georgia,serif;color:#44403c">
<p style="font-family:Inter,system-ui,sans-serif;font-size:14px;margin:0 0 12px"><a href="/" style="color:#1c1917;text-decoration:none;font-weight:600">NatureGram</a></p>
${p.image ? `<img src="${e(p.image)}" alt="${e(name)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;background:#efe7d6" referrerpolicy="no-referrer">` : ''}
<h1 style="font-style:italic;font-weight:500;font-size:28px;color:#1c1917;margin:16px 0 2px">${slug ? `<a href="/species/${slug}" style="color:inherit">${e(name)}</a>` : e(name)}</h1>
${p.scientific && p.scientific !== name ? `<p style="font-style:italic;color:#8a7a60;margin:0">${e(p.scientific)}</p>` : ''}
<p style="font-family:Inter,system-ui,sans-serif;font-size:13px;color:#78716c">${e([p.author ? `Seen by ${p.author}` : 'Seen by a NatureGram explorer', p.area ? `near ${p.area}` : '', fieldDate(p.observedMs || p.ms)].filter(Boolean).join(' · '))}${p.verified ? ' · Community verified' : ''}</p>
${p.caption ? `<p style="font-size:17px;line-height:1.55">${e(p.caption)}</p>` : ''}
${p.observed && p.observed !== p.caption ? `<p style="font-size:17px;line-height:1.55">${e(p.observed)}</p>` : ''}
${p.insight ? `<p style="font-size:16px;line-height:1.55;border-left:2px solid #d8ccb6;padding-left:12px">${e(p.insight)}<br><small style="font-family:Inter,system-ui,sans-serif;color:#78716c">The guide's note: an AI suggestion.</small></p>` : ''}
</article>`;
}

/** Head tags for the app shell: title, description, canonical, social cards, robots, JSON-LD. */
export function shellHead({ host, path, title, description, image, imageAlt, imageSize, type = 'website', noindex = false, follow = false, ld }) {
  const url = `${origin(host)}${path}`;
  const img = image || `${origin(host)}/og-default.jpg?v=2`;
  const size = image ? imageSize : [1200, 630];
  return `<title>${e(title)}</title>
    <meta name="description" content="${e(description)}" />
    <link rel="canonical" href="${e(url)}" />
    ${noindex ? `<meta name="robots" content="noindex, ${follow ? 'follow' : 'nofollow'}" />` : '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />'}
    <meta property="og:type" content="${e(type)}" />
    <meta property="og:site_name" content="NatureGram" />
    <meta property="og:url" content="${e(url)}" />
    <meta property="og:title" content="${e(title)}" />
    <meta property="og:description" content="${e(description)}" />
    <meta property="og:image" content="${e(img)}" />
    <meta property="og:image:alt" content="${e(imageAlt || title)}" />${size ? `
    <meta property="og:image:width" content="${size[0]}" />
    <meta property="og:image:height" content="${size[1]}" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${e(title)}" />
    <meta name="twitter:description" content="${e(description)}" />
    <meta name="twitter:image" content="${e(img)}" />
    ${ld ? ldScript(ld) : ''}`;
}

/**
 * Replace the default head tags in index.html with page-specific ones, and optionally put readable
 * content inside #root (React replaces it when the app mounts).
 */
export function injectShell(html, head, rootHtml = '') {
  let out = String(html)
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name="(?:description|robots|twitter:[a-z:]+)"[^>]*>\s*/gi, '')
    .replace(/<meta\s+property="og:[a-z:_]+"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '')
    .replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, '');
  out = out.replace(/<meta\s+name="viewport"[^>]*>/i, (m) => `${m}\n    ${head}`);
  if (rootHtml) out = out.replace('<div id="root"></div>', `<div id="root">${rootHtml}</div>`);
  return out;
}

export { postLd, GROUP_NOUN };
