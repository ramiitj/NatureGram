/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import fs from 'fs';
import { escapeHtml } from '../lib/escapeHtml.js';

// Registers the dynamic social-sharing route (/s/:postId), which serves an
// Open Graph/Twitter Card preview to crawlers and redirects real browsers
// straight into the app.
export function registerSharePreviewRoute(app) {
  app.get('/s/:postId', async (req, res) => {
    const postId = req.params.postId;

    // Robustly construct site and app URLs, avoiding pointing users to localhost under reverse proxies
    const rawHost = req.headers['x-forwarded-host'] || req.headers['x-forwarded-server'] || req.get('host') || 'thenaturegram.com';
    const isLocalhost = rawHost.includes('localhost') || rawHost.includes('127.0.0.1');
    const resolvedHost = (isLocalhost && process.env.NODE_ENV === 'production') ? 'thenaturegram.com' : rawHost;

    const siteUrl = `https://${resolvedHost}/s/${postId}`;
    const appUrl = `https://${resolvedHost}/?post=${postId}`;

    // Detect if this is a web scraping crawler/social bot or a real user browser
    const userAgent = req.headers['user-agent'] || '';
    const isCrawler = /bot|googlebot|crawler|spider|robot|crawling|facebook|twitter|instagram|whatsapp|telegram|discord|slack|linkedin/i.test(userAgent);

    // If it's a real user browser (not a crawler), redirect them immediately via HTTP 302
    if (!isCrawler) {
      return res.redirect(302, appUrl);
    }

    // W3: these used to default to this deployment's actual project ID/key
    // as a hardcoded fallback — harmless only because it happened to match;
    // a fork pointed at a different Firebase project that forgot to update
    // firebase-applet-config.json would have silently queried someone
    // else's project instead of failing. Now a missing/incomplete config
    // just falls through to the existing catch-all redirect below.
    let firebaseApiKey = null;
    let projectID = null;
    let databaseID = "(default)";

    try {
      const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        projectID = config.projectId || null;
        firebaseApiKey = config.apiKey || null;
        databaseID = config.firestoreDatabaseId || databaseID;
      }
    } catch (e) {
      console.error("Failed to load Firebase config in server sharing route:", e);
    }

    if (!projectID || !firebaseApiKey) {
      console.error('[SharePreview] No Firebase project config resolved — redirecting instead of rendering a preview.');
      return res.redirect(302, appUrl);
    }

    try {
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectID}/databases/${databaseID}/documents/ecosystem_feed/${postId}?key=${firebaseApiKey}`;
      const fsResponse = await fetch(firestoreUrl);

      if (!fsResponse.ok) throw new Error('Post not found');
      const data = await fsResponse.json();

      const fields = data.fields;
      // Handle potential variations in document structure
      const items = fields.items?.arrayValue?.values || [];
      const mainItem = items.length > 0 ? items[0].mapValue.fields : fields;

      const labels = mainItem.labels?.arrayValue?.values?.map(v => v.stringValue) || [];
      const commonName = labels.length > 0 ? labels[0] : 'Nature';
      const scientificName = labels.length > 1 ? `(${labels[1]})` : '';

      const title = fields.title?.stringValue || `NatureGram Discovery: ${commonName} ${scientificName}`.trim();

      const aiInsight = mainItem.aiInsight?.stringValue;
      const description = fields.description?.stringValue || aiInsight || mainItem.description?.stringValue || 'A new nature discovery on NatureGram.';

      const imageUrl = fields.thumbnailUrl?.stringValue || fields.imageUrl?.stringValue || mainItem.thumbnailUrl?.stringValue || mainItem.imageUrl?.stringValue || 'https://naturegram.app/og-default.jpg';

      const tags = fields.tags?.arrayValue?.values?.map(v => v.stringValue) ||
                   mainItem.tags?.arrayValue?.values?.map(v => v.stringValue) ||
                   [];

      // Everything above is sourced from Firestore post fields, which are
      // user-controlled (any signed-in user can create/edit a post). Escape
      // it all before interpolating into the response HTML to prevent
      // stored XSS against anyone (including bots/crawlers) loading this
      // share-preview page.
      const safeTitle = escapeHtml(title);
      const safeDescription = escapeHtml(description);
      const safeImageUrl = escapeHtml(imageUrl);
      const safeSiteUrl = escapeHtml(siteUrl);
      const safeAppUrl = escapeHtml(appUrl);
      const safeTags = tags.map(tag => escapeHtml(tag.startsWith('#') ? tag : '#' + tag));

      // Return a specialized preview HTML page featuring the thumbnail, tags, and hyperlink
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <meta name="title" content="${safeTitle}">
    <meta name="description" content="${safeDescription}">

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${safeSiteUrl}">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:image" content="${safeImageUrl}">

    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="${safeSiteUrl}">
    <meta property="twitter:title" content="${safeTitle}">
    <meta property="twitter:description" content="${safeDescription}">
    <meta property="twitter:image" content="${safeImageUrl}">

    <!-- UI & Fonts imports -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      // Browser-side absolute fallback to ensure instant redirect for humans even if backend crawler detection was bypassed
      window.location.replace("${safeAppUrl}");

      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              sans: ['Inter', 'sans-serif'],
              display: ['Space Grotesk', 'sans-serif'],
            }
          }
        }
      }
    </script>
</head>
<body class="bg-[#faf9f6] text-stone-900 font-sans flex flex-col items-center justify-center min-h-screen p-4 md:p-6 select-none">
    <div class="max-w-md w-full bg-white rounded-3xl overflow-hidden shadow-2xl border border-stone-200/50 flex flex-col p-6 gap-6 transition-all transform hover:scale-[1.01] hover:shadow-emerald-950/5 animate-fade-in">

        <!-- NatureGram Brand -->
        <div class="flex items-center justify-between pb-3 border-b border-stone-100 shrink-0">
            <h1 class="text-xl font-bold font-display italic tracking-tight text-emerald-800">NatureGram</h1>
            <div class="flex items-center gap-1.5 opacity-60">
                <span class="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></span>
                <p class="text-[9px] font-mono font-bold tracking-widest uppercase">Shared post</p>
            </div>
        </div>

        <!-- Thumbnail link (Clickable to view full post) -->
        <a href="${safeAppUrl}" id="shared_post_thumbnail" class="block group relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-stone-100 border border-stone-200">
            <img src="${safeImageUrl}"
                 alt="${safeTitle}"
                 referrerpolicy="no-referrer"
                 class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <!-- Hover Overlay -->
            <div class="absolute inset-0 bg-stone-950/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="px-4 py-2 rounded-full bg-white/95 shadow-lg text-[10px] font-black text-stone-900 uppercase tracking-widest flex items-center gap-1">
                    Launch in app
                    <span class="material-symbols-outlined text-[10px]">open_in_new</span>
                </div>
            </div>
        </a>

        <!-- Content Info -->
        <div class="space-y-3">
            <div class="flex flex-wrap gap-1.5">
                ${safeTags.length > 0
                  ? safeTags.map(tag => `
                    <span class="px-2.5 py-1 bg-emerald-50 border border-emerald-100/60 text-emerald-800 text-[9px] uppercase font-black tracking-widest rounded-md">
                        ${tag}
                    </span>
                  `).join('')
                  : `<span class="px-2.5 py-1 bg-emerald-50 border border-emerald-100/60 text-emerald-800 text-[9px] uppercase font-black tracking-widest rounded-md">#NATURE</span>`
                }
            </div>

            <h2 class="text-xl font-bold font-display tracking-tight text-stone-900 leading-snug">
                ${safeTitle}
            </h2>

            <p class="text-stone-600/90 text-xs leading-relaxed line-clamp-3">
                ${safeDescription}
            </p>
        </div>

        <!-- Call to Action (Hyperlink to view full post directly) -->
        <a href="${safeAppUrl}" id="shared_post_btn" class="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-4 px-6 rounded-2xl font-bold shadow-lg shadow-emerald-700/10 active:scale-95 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] tracking-wider text-center">
            <span>Directly View Full Post</span>
            <span class="material-symbols-outlined text-sm font-black animate-pulse">arrow_forward</span>
        </a>
    </div>
</body>
</html>`;
      res.send(html);
    } catch (e) {
      console.error("Error fetching post for OG tags:", e);
      // Fallback redirect for users to main app page
      res.redirect(302, appUrl);
    }
  });
}
