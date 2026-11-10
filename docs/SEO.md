# Search and AI discoverability

NatureGram is a single-page app, so search engines and AI answer engines (ChatGPT search, Perplexity, Google AI Overviews, Claude) could see almost nothing without JavaScript. The server now publishes plain, fast HTML for everything public, with structured data, sitemaps and an `llms.txt`. Code: `server/seo.js` (pure helpers, tested in `server/test/seo.test.mjs`), `server/seoPages.js` (HTML), `server/seoRoutes.js` (routes, data and caching), `server/indexNow.js`.

## What is public, and what never is

| Shown | Never shown |
|---|---|
| Public sightings that passed moderation (`isPublic`, not hidden, not pending, held, rejected or edited, not demo posts) | Private or journal-only sightings, hidden or pending ones |
| A coarse area (the last two parts of `locationArea`, such as "Golaghat, Assam") | Coordinates, ever. The area is dropped when the explorer hid it, when the guide flagged a sensitive species, or when it looks like coordinates |
| Usernames of non-guest explorers whose profile is not private (`profilePrivate`) | Teen explorers (`ageBand: 'teen'`) and all their sightings; guest names; fallback names like `Explorer-ab12` (they hold part of the account ID); user IDs; emails and phone numbers (removed from captions and bios) |

A sighting whose author profile can't be read is left out rather than guessed about. A username that matches more than one profile shows nobody.

## Routes

| Route | What it is | Status codes |
|---|---|---|
| `/robots.txt` | Crawl rules and the AI crawler policy | 200 |
| `/sitemap.xml` | Sitemap index | 200 |
| `/sitemaps/static.xml`, `naturalists.xml`, `species.xml`, `explorers.xml`, `posts-N.xml` | Sub-sitemaps with `lastmod`; species and posts carry image entries | 200, 503 while the store is unavailable, 404 past the last posts page |
| `/llms.txt`, `/llms-full.txt` | Plain-language guides for language models: what NatureGram is, key pages, the species index, how to cite | 200 |
| `/about` | FAQ (FAQPage structured data) | 200 |
| `/species` | Species index grouped by kind of life | 200 / 503 |
| `/species/:slug` | Field-guide page per species, aggregated from public sightings. Any common or scientific name's slug redirects (301) to the canonical one | 200 / 301 / 404 / 503 |
| `/naturalists`, `/naturalists/:id` | Naturalists of the fortnight: bio, philosophy, lifespan, quote, challenge, community answers (posts with the challenge tag) | 200 / 404 |
| `/explorer/:username` | Public field page of a non-teen, non-guest, non-private explorer with public sightings | 200 / 301 (case) / 404 / 503 |
| `/post/:id` | The app, with server-side title, description, social cards, JSON-LD and readable content inside `#root` (React replaces it on load) | 200; 404 for unknown, private, pending or teen sightings; 410 for hidden ones (the app still loads, so owners see their own private sightings) |
| `/s/:postId` | Share card for social crawlers; canonical now points at `/post/:id`; teen, hidden and pending sightings get the generic card with `noindex` | 200 / 302 for people |
| `/`, `/explore`, `/feed`, `/reels` | The app with route-specific head tags and Organization, WebSite (SearchAction) and WebApplication JSON-LD. `/explore?q=` is `noindex` | 200 |
| `/admin`, `/messages`, `/review`, `/lens`, `/drafts`, `/auth/action`, `/guardian`, `/welcome`, `/journal`, `/profile/*` | The app, with `noindex, nofollow` (meta and `X-Robots-Tag`) | 200 |
| `/<INDEXNOW_KEY>.txt` | IndexNow key file (only when the key is set) | 200 |
| `www.thenaturegram.com/*` | 301 to `https://thenaturegram.com/*` (308 for non-GET) | 301 |

Every other path is a 404 with `noindex`. Public pages send `Cache-Control: public, max-age=300, stale-while-revalidate=3600` with an ETag (Express answers 304 when unchanged); discovery files cache for an hour; responses are gzip-compressed. Pages carry no client JavaScript.

Data: the most recent `SEO_CORPUS_LIMIT` public sightings (default 2000) plus their authors' profiles are read once an hour per instance and served stale while refreshing, so crawls cost almost no Firestore reads. Single posts are cached 5 minutes, explorer pages 10 minutes. When the store fails, pages answer 503 with `Retry-After` for a minute instead of waiting on timeouts. The naturalists ship with the build as `dist/seo/naturalists.json` (written by a small plugin in `vite.config.ts`).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `AI_CRAWLERS` | `search-only` | AI crawler policy in robots.txt: `allow`, `search-only` or `deny` |
| `INDEXNOW_KEY` | off | Turns on IndexNow pings on publish and serves `/<key>.txt` |
| `SEO_CORPUS_LIMIT` | 2000 | Recent public sightings used for species pages and sitemaps (50 to 10000) |
| `IOS_APP_URL`, `ANDROID_APP_URL` | empty | Store listings; when set, MobileApplication structured data is added |
| `PUBLIC_HOST` | `thenaturegram.com` | Canonical host used in every URL |

### The AI crawler trade-off

There are two kinds of AI crawler:

- **Search and citation** (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, DuckAssistBot) fetch pages to answer a question and link back. Blocking them means NatureGram is not cited in those answers.
- **Training** (GPTBot, ClaudeBot, anthropic-ai, Google-Extended, Applebot-Extended, CCBot, meta-externalagent, cohere-training-data-crawler) collect text for future models. Allowing them may make models "know" NatureGram, but sends no traffic, and explorers' captions and photo links become training data.

Modes:

- `allow` (default): both kinds are allowed on public pages.
- `search-only`: citation crawlers allowed, training crawlers blocked. **Consider this mode**: the terms of use give NatureGram a licence to display explorers' content "within NatureGram and in previews"; model training by third parties is arguably beyond what explorers agreed to. Search citation stays a preview with a link.
- `deny`: both kinds blocked.

Google AI Overviews and AI Mode use the ordinary Googlebot, so they follow the normal rules in every mode; `Google-Extended` only controls Gemini training. Robots rules are a request, not enforcement.

Change it with `gcloud run services update <service> --region <region> --update-env-vars=AI_CRAWLERS=search-only`.

## Owner steps

### 1. Domain

1. Make sure `www.thenaturegram.com` points at the same Cloud Run service (domain mapping or load balancer) so the server can redirect it to the apex. If www isn't mapped, add a forwarding rule at GoDaddy (Domain → Forwarding → `https://thenaturegram.com`, permanent 301).
2. Open `https://thenaturegram.com/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/about` and one `/species/...` page to confirm they load.

### 2. Google Search Console

1. Go to search.google.com/search-console → Add property → **Domain** → `thenaturegram.com`.
2. Copy the `google-site-verification=...` TXT record.
3. GoDaddy → My Products → thenaturegram.com → DNS → Add record: Type **TXT**, Name **@**, Value the copied string, TTL 1 hour. Save.
4. Back in Search Console press **Verify** (DNS can take from minutes to a few hours; retry if it fails).
5. Sitemaps → enter `sitemap.xml` → Submit. Status should read "Success" with the sub-sitemaps listed.
6. URL inspection: paste `https://thenaturegram.com/`, a species page and a `/post/...` URL → **Test live URL** → View tested page (check the HTML has the title and JSON-LD) → **Request indexing**.
7. Validate structured data with the Rich Results Test (search.google.com/test/rich-results) and validator.schema.org on a species page, a post and `/about`.

### 3. Bing Webmaster Tools (also feeds ChatGPT search and DuckDuckGo)

1. bing.com/webmasters → Sign in → **Import from Google Search Console** (verifies the site and imports the sitemap).
2. IndexNow: generate a key (for example `openssl rand -hex 16`), then `gcloud run services update <service> --region <region> --update-env-vars=INDEXNOW_KEY=<key>`. Check `https://thenaturegram.com/<key>.txt` shows the key. Each public sighting is then pinged to IndexNow within about 10 seconds of publishing (never a teen's). Bing → IndexNow shows received URLs.

### 4. Checking the AI crawlers

- Cloud Run logs (Logs Explorer): `httpRequest.userAgent =~ "GPTBot|OAI-SearchBot|ChatGPT-User|PerplexityBot|ClaudeBot|Claude-SearchBot|Claude-User|Google-Extended|Applebot"` shows who fetched what, and the status codes they got.
- Test as a bot: `curl -A "OAI-SearchBot/1.0" https://thenaturegram.com/species/<slug>`; the HTML must contain the species name and facts without JavaScript.
- Ask the engines: in ChatGPT search, Perplexity and Claude, ask "What is NatureGram?" or "Barn owl sightings on NatureGram" and check they cite thenaturegram.com pages. New sites can take weeks to appear.
- Optional: Cloudflare-style bot analytics are not available on Cloud Run; logs are the source of truth.

### 5. What to monitor

- **Search Console**: Pages (indexed vs not indexed and why), Sitemaps (errors), Enhancements (Breadcrumbs, structured data errors), Core Web Vitals, Performance (queries, clicks). Expect `/post/` URLs for private or teen sightings to show as "Not found (404)" or "Excluded by noindex": that is intended.
- **Bing Webmaster**: Site Explorer, IndexNow, crawl errors.
- **Server logs**: `seo corpus built` once an hour per instance (sizes), `seo corpus unavailable` / `seo post unavailable` (store problems; pages answer 503 meanwhile), `indexnow ping` status.
- **Monthly**: spot-check a few species pages and a teen account's post URL (must 404 with `noindex`), and confirm no exact places appear anywhere.

## Internal links

Species pages link to their recent sightings and to related species of the same kind; posts link to their species page (breadcrumb, fallback content and `about` → Taxon); explorer pages link to species; naturalist pages link to the previous and next naturalist and to community answers. In the app, the species sheet links to the species' field guide page.
