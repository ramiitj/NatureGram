// Run: node --test server/test/seo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify, redactContacts, coarseArea, publicPost, publicExplorer, buildCorpus, speciesSummary, relatedSpecies, groupOf,
  robotsTxt, aiCrawlerMode, sitemapIndexXml, urlsetXml, escapeXml, ldScript, postLd, taxonLd, observationsListLd, personLd,
  websiteLd, organizationLd, breadcrumbLd, faqLd, FAQS, llmsTxt, mergeNaturalists, featuredWindow, appLd, AI_TRAINING_BOTS, AI_SEARCH_BOTS,
} from '../seo.js';
import { injectShell, shellHead, speciesPage, layout } from '../seoPages.js';
import { NOINDEX_ROUTE } from '../seoRoutes.js';

const HOST = 'thenaturegram.com';
const ts = (iso) => ({ toMillis: () => Date.parse(iso) });
const adult = { username: 'fernwatcher', ageBand: 'adult' };
const post = (over = {}) => ({
  isPublic: true, userId: 'uid_adult', labels: ['Barn owl', 'Tyto alba'], tags: ['#owl'], timestamp: ts('2026-03-14T10:00:00Z'),
  showLocation: true, locationArea: 'Kaziranga, Golaghat, Assam', imageUrl: 'https://firebasestorage.googleapis.com/x.jpg',
  moderation: { status: 'clear' }, reportStatus: 'safe', aiFlags: { sensitiveSpecies: false, isNatureSubject: true }, caption: 'Hunting at dusk',
  ...over,
});

// ------------------------------------------------------------------ slugs and text
test('slugs are lowercase, ascii and hyphenated', () => {
  assert.equal(slugify('Barn owl'), 'barn-owl');
  assert.equal(slugify('Turdus merula'), 'turdus-merula');
  assert.equal(slugify('  Ruppell’s griffon vulture!! '), 'ruppells-griffon-vulture');
  assert.equal(slugify('Épervier d\'Europe'), 'epervier-deurope');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify(''), '');
  assert.ok(slugify('a'.repeat(200)).length <= 80);
  assert.ok(!slugify(`${'ab '.repeat(40)}`).endsWith('-'));
});

test('contact details are removed from explorer text', () => {
  assert.equal(redactContacts('write to me@example.com today'), 'write to [email removed] today');
  assert.match(redactContacts('call +91 98765 43210'), /\[number removed\]/);
  assert.equal(redactContacts('Seen in 2026, 3 times'), 'Seen in 2026, 3 times');
});

test('areas are coarse and never coordinates', () => {
  assert.equal(coarseArea('Kaziranga, Golaghat, Assam'), 'Golaghat, Assam');
  assert.equal(coarseArea('26.5775, 93.1711'), '');
  assert.equal(coarseArea('12°58′N 77°35′E'), '');
  assert.equal(coarseArea(''), '');
});

test('the group of life matches the app', () => {
  assert.equal(groupOf({ labels: ['Barn owl'] }), 'Birds');
  assert.equal(groupOf({ labels: ['Fly agaric'], aiFlags: { fungi: true } }), 'Fungi');
  assert.equal(groupOf({ labels: ['Common oak', 'Quercus robur'] }), 'Plants');
  assert.equal(groupOf({ labels: ['Something'] }), 'Other life');
});

// ------------------------------------------------------------------ privacy
test('a public, cleared sighting appears with a coarse place and the username', () => {
  const p = publicPost('abc123', post(), adult);
  assert.ok(p);
  assert.equal(p.name, 'Barn owl');
  assert.equal(p.scientific, 'Tyto alba');
  assert.equal(p.area, 'Golaghat, Assam');
  assert.equal(p.author, 'fernwatcher');
  assert.equal(p.group, 'Birds');
});

test('private, hidden, pending, held and demo sightings never appear', () => {
  assert.equal(publicPost('a1', post({ isPublic: false }), adult), null);
  assert.equal(publicPost('a2', post({ reportStatus: 'hidden' }), adult), null);
  for (const status of ['pending', 'held', 'rejected', 'edited']) assert.equal(publicPost('a3', post({ moderation: { status } }), adult), null, status);
  assert.equal(publicPost('seed_1', post(), adult), null);
  assert.equal(publicPost('a4', post({ aiFlags: { isNatureSubject: false } }), adult), null);
  assert.equal(publicPost('bad/id', post(), adult), null);
});

test('teen explorers and their sightings never appear', () => {
  const teen = { username: 'younglark', ageBand: 'teen' };
  assert.equal(publicPost('t1', post(), teen), null);
  assert.equal(publicExplorer(teen), null);
});

test('a sighting whose author could not be read is left out', () => {
  assert.equal(publicPost('u1', post(), undefined), null);
  // No profile document at all (an old account): shown, without a name
  const p = publicPost('u2', post(), null);
  assert.ok(p);
  assert.equal(p.author, null);
});

test('sensitive species and hidden places lose the place entirely', () => {
  assert.equal(publicPost('s1', post({ aiFlags: { sensitiveSpecies: true } }), adult).area, '');
  assert.equal(publicPost('s2', post({ items: [{ aiFlags: { sensitiveSpecies: true } }] }), adult).area, '');
  assert.equal(publicPost('s3', post({ showLocation: false }), adult).area, '');
});

test('usernames only for non-guest, non-private profiles; no IDs or emails', () => {
  assert.equal(publicExplorer({ username: 'guest1', isAnonymous: true }), null);
  assert.equal(publicExplorer({ username: 'quiet', profilePrivate: true }), null);
  assert.equal(publicExplorer({ username: 'Explorer-ab12' }), null);
  assert.equal(publicExplorer({ username: 'a@b.com' }), null);
  assert.equal(publicExplorer({ username: 'fernwatcher' }), 'fernwatcher');
  const p = publicPost('e1', post({ caption: 'Mail me at me@example.com', userId: 'SECRETUID123' }), { username: 'g', isAnonymous: true });
  assert.equal(p.author, null);
  const ld = JSON.stringify(postLd(HOST, p));
  assert.ok(!ld.includes('me@example.com'));
  assert.ok(!ld.includes('SECRETUID123'));
  assert.ok(!layoutHas(p, 'SECRETUID123'));
});
function layoutHas(p, needle) {
  const c = buildCorpus([p]);
  const s = [...c.species.values()][0];
  return speciesPage({ host: HOST, corpus: c, s }).includes(needle);
}

// ------------------------------------------------------------------ corpus
test('species aggregate sightings, merge common and scientific names, and alias both', () => {
  const posts = [
    publicPost('p1', post(), adult),
    publicPost('p2', post({ labels: ['Barn owl'], timestamp: ts('2026-07-01T10:00:00Z'), userId: 'uid2', locationArea: 'Bristol, England' }), { username: 'owlet' }),
    publicPost('p3', post({ labels: ['Common oak', 'Quercus robur'], tags: [] }), adult),
    publicPost('p4', post({ labels: ['Sessile oak', 'Quercus petraea'], tags: [] }), adult),
  ];
  const c = buildCorpus(posts);
  const owl = c.species.get('tyto-alba');
  assert.ok(owl);
  assert.equal(owl.count, 2);
  assert.equal(owl.explorers, 2);
  assert.deepEqual(owl.monthList, ['March', 'July']);
  assert.equal(c.aliases.get('barn-owl'), 'tyto-alba');
  assert.equal(owl.group, 'Birds');
  assert.match(speciesSummary(owl), /Barn owl \(Tyto alba\) is a bird recorded twice on NatureGram by 2 explorers/);
  assert.deepEqual(relatedSpecies(c, c.species.get('quercus-robur')).map(s => s.slug), ['quercus-petraea']);
  assert.equal(c.explorers.get('fernwatcher').count, 3);
  // No account IDs leak into what pages render
  assert.ok(!JSON.stringify([...c.species.values()].map(s => ({ ...s, posts: undefined }))).includes('uid_adult'));
});

// ------------------------------------------------------------------ JSON-LD
test('JSON-LD shapes', () => {
  const site = websiteLd(HOST);
  assert.equal(site.potentialAction['@type'], 'SearchAction');
  assert.equal(site.potentialAction.target.urlTemplate, 'https://thenaturegram.com/explore?q={search_term_string}');
  assert.equal(organizationLd(HOST)['@type'], 'Organization');
  assert.equal(appLd(HOST).length, 1);
  assert.equal(appLd(HOST, { iosUrl: 'https://apps.apple.com/app/id1' })[1]['@type'], 'MobileApplication');

  const p = publicPost('p1', post(), adult);
  const ld = postLd(HOST, p, { slug: 'tyto-alba' });
  assert.equal(ld['@type'], 'SocialMediaPosting');
  assert.equal(ld.author.name, 'fernwatcher');
  assert.equal(ld.image['@type'], 'ImageObject');
  assert.equal(ld.about['@type'], 'Taxon');
  assert.equal(ld.about.url, 'https://thenaturegram.com/species/tyto-alba');
  assert.equal(ld.contentLocation.name, 'Golaghat, Assam');
  assert.equal(ld.datePublished, '2026-03-14T10:00:00.000Z');
  const hidden = postLd(HOST, publicPost('p9', post({ showLocation: false }), adult));
  assert.equal(hidden.contentLocation, undefined);

  const c = buildCorpus([p]);
  const s = c.species.get('tyto-alba');
  const tx = taxonLd(HOST, s);
  assert.equal(tx['@type'], 'Taxon');
  assert.equal(tx.name, 'Tyto alba');
  assert.equal(tx.taxonRank, 'species');
  assert.deepEqual(tx.alternateName, ['Barn owl']);
  assert.equal(observationsListLd(HOST, s).itemListElement[0].url, 'https://thenaturegram.com/post/p1');

  const per = personLd(HOST, { id: 'darwin', naturalist: 'Charles Darwin', lifespan: '1809–1882', bio: 'x', wiki: 'https://en.wikipedia.org/wiki/Charles_Darwin' });
  assert.equal(per['@type'], 'Person');
  assert.equal(per.birthDate, '1809');
  assert.equal(per.deathDate, '1882');
  assert.equal(personLd(HOST, { id: 'a', naturalist: 'A', lifespan: 'b. 1926' }).birthDate, '1926');

  const bc = breadcrumbLd(HOST, [{ name: 'NatureGram', path: '/' }, { name: 'Species', path: '/species' }]);
  assert.equal(bc.itemListElement[1].position, 2);
  assert.equal(bc.itemListElement[1].item, 'https://thenaturegram.com/species');
  const faq = faqLd(FAQS);
  assert.equal(faq['@type'], 'FAQPage');
  assert.ok(faq.mainEntity.every(q => q['@type'] === 'Question' && q.acceptedAnswer.text.length > 40));
});

test('JSON-LD script blocks cannot be broken out of', () => {
  const s = ldScript({ name: '</script><script>alert(1)</script>' });
  assert.equal((s.match(/<\/script>/g) || []).length, 1);
  assert.doesNotThrow(() => JSON.parse(s.replace(/^<script[^>]*>|<\/script>$/g, '')));
});

// ------------------------------------------------------------------ robots.txt
test('robots.txt per AI crawler mode', () => {
  assert.equal(aiCrawlerMode(undefined), 'allow');
  assert.equal(aiCrawlerMode('SEARCH-ONLY'), 'search-only');
  assert.equal(aiCrawlerMode('nonsense'), 'allow');

  const allow = robotsTxt({ host: HOST, mode: 'allow' });
  assert.match(allow, /Sitemap: https:\/\/thenaturegram\.com\/sitemap\.xml/);
  for (const p of ['/admin', '/messages', '/review', '/lens', '/drafts', '/auth/', '/guardian', '/welcome']) assert.ok(allow.includes(`Disallow: ${p}\n`), p);
  for (const b of [...AI_SEARCH_BOTS, ...AI_TRAINING_BOTS]) assert.ok(allow.includes(`User-agent: ${b}\n`), b);
  assert.ok(!/User-agent: GPTBot[\s\S]*?\nDisallow: \/\n/.test(allow));

  const so = robotsTxt({ host: HOST, mode: 'search-only' });
  const groups = so.split('\n\n');
  const groupOfBot = (bot) => groups.find(g => g.includes(`User-agent: ${bot}\n`));
  assert.match(groupOfBot('GPTBot'), /\nDisallow: \/(\n|$)/);
  assert.match(groupOfBot('ClaudeBot'), /\nDisallow: \/(\n|$)/);
  assert.match(groupOfBot('Google-Extended'), /\nDisallow: \/(\n|$)/);
  assert.match(groupOfBot('OAI-SearchBot'), /\nAllow: \/\n/);
  assert.match(groupOfBot('Claude-SearchBot'), /\nAllow: \/\n/);
  assert.match(groupOfBot('PerplexityBot'), /\nAllow: \/\n/);

  const deny = robotsTxt({ host: HOST, mode: 'deny' }).split('\n\n');
  for (const b of ['GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot']) assert.match(deny.find(g => g.includes(`User-agent: ${b}\n`)), /\nDisallow: \/(\n|$)/);
  // Ordinary search engines stay welcome in every mode
  assert.match(deny.find(g => g.includes('User-agent: *')), /\nAllow: \/\n/);
});

// ------------------------------------------------------------------ sitemaps
const wellFormed = (xml) => {
  // A tiny well-formedness check: balanced tags, no raw ampersands
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'unescaped &');
  const stack = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([a-zA-Z:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2]); else stack.push(m[2]);
  }
  assert.equal(stack.length, 0);
};

test('sitemap XML is valid and escaped', () => {
  const idx = sitemapIndexXml([{ loc: 'https://thenaturegram.com/sitemaps/static.xml', lastmod: '2026-11-10' }]);
  wellFormed(idx);
  assert.match(idx, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const set = urlsetXml([
    { loc: 'https://thenaturegram.com/species/tyto-alba', lastmod: '2026-03-14', images: ['https://x.example/a.jpg?w=1&h=2'] },
    { loc: 'https://thenaturegram.com/explorer/a&b' },
  ]);
  wellFormed(set);
  assert.match(set, /xmlns:image=/);
  assert.match(set, /a\.jpg\?w=1&amp;h=2/);
  assert.equal(escapeXml('a\u0001b<'), 'ab&lt;');
});

// ------------------------------------------------------------------ llms.txt, naturalists, shell
test('llms.txt describes the site, the species and how to cite', () => {
  const c = buildCorpus([publicPost('p1', post(), adult)]);
  const nats = mergeNaturalists([{ id: 'darwin', naturalist: 'Charles Darwin', quote: 'q' }], { darwin: { lifespan: '1809–1882', bio: 'Voyage of the Beagle.', challenge: 'Find two related organisms.', challengeTag: '#DarwinVariations' } });
  const t = llmsTxt({ host: HOST, corpus: c, naturalists: nats });
  assert.match(t, /^# NatureGram\n\n> /);
  assert.match(t, /## How to cite/);
  assert.match(t, /\[Barn owl \(Tyto alba\)\]\(https:\/\/thenaturegram\.com\/species\/tyto-alba\)/);
  const full = llmsTxt({ host: HOST, corpus: c, naturalists: nats, full: true });
  assert.match(full, /### Birds/);
  assert.match(full, /Voyage of the Beagle/);
  assert.match(full, /## Frequently asked questions/);
  assert.equal(nats[0].wiki, 'https://en.wikipedia.org/wiki/Charles_Darwin');
});

test('featured windows cover the year in order', () => {
  const a = featuredWindow(0, 2026);
  const b = featuredWindow(1, 2026);
  const last = featuredWindow(23, 2026);
  assert.equal(a.start.toISOString().slice(0, 10), '2026-01-01');
  assert.ok(b.start > a.end);
  assert.equal(last.end.toISOString().slice(0, 10), '2026-12-31');
});

test('the app shell gets page-specific head tags in place of the defaults', () => {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width" />
<title>Old</title><meta name="description" content="old" /><link rel="canonical" href="https://thenaturegram.com/" />
<meta property="og:title" content="old" /><meta name="twitter:card" content="x" />
<script type="application/ld+json">{"old":true}</script><meta name="theme-color" content="#1c1917" />
</head><body><div id="root"></div></body></html>`;
  const head = shellHead({ host: HOST, path: '/post/abc', title: 'Barn owl · NatureGram', description: 'd', noindex: true, ld: { '@context': 'https://schema.org' } });
  const out = injectShell(html, head, '<article>Barn owl</article>');
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.match(out, /<title>Barn owl · NatureGram<\/title>/);
  assert.equal((out.match(/rel="canonical"/g) || []).length, 1);
  assert.match(out, /href="https:\/\/thenaturegram\.com\/post\/abc"/);
  assert.match(out, /noindex/);
  assert.ok(!out.includes('{"old":true}'));
  assert.match(out, /theme-color/);
  assert.match(out, /<div id="root"><article>Barn owl<\/article><\/div>/);
});

test('app-only routes are noindex; public ones are not', () => {
  for (const p of ['/admin', '/messages', '/review', '/lens', '/drafts', '/auth/action', '/guardian', '/welcome', '/journal', '/profile/abc']) assert.ok(NOINDEX_ROUTE.test(p), p);
  for (const p of ['/', '/explore', '/feed', '/post/abc', '/reels']) assert.ok(!NOINDEX_ROUTE.test(p), p);
});

test('server pages are lightweight and script-free', () => {
  const html = layout({ host: HOST, path: '/about', title: 'About', description: 'd', body: '<p>x</p>', ld: { a: 1 } });
  assert.ok(!/<script(?![^>]*application\/ld\+json)/.test(html));
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/thenaturegram\.com\/about">/);
  assert.match(html, /og:image:width/);
});
