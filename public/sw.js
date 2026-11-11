/* NatureGram service worker: offline shell + fast repeat loads. Never caches API/AI traffic. */
const VERSION = 'ng-v8';
const SHELL = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Cross-origin requests (fonts, Firebase, analytics) are left to the browser's HTTP cache:
  // intercepting them risks serving opaque responses to CORS requests (breaks web fonts).
  if (url.origin !== self.location.origin) return;
  // The feed's first page: show the last copy at once on repeat visits, refresh it in the background
  if (url.pathname === '/api/feed/first') {
    event.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit || Response.error());
      return hit || net;
    }));
    return;
  }
  // The manifest and home-screen icons follow the current mark: always from the network
  if (url.pathname.startsWith('/manifest') || url.pathname.startsWith('/brand/') || /^\/icon(-\d+\.png|\.svg)$/.test(url.pathname)) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/s/') || url.pathname === '/healthz') return;

  // App navigations: network-first, offline fallback to the cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/', copy)); }
        return res;
      }).catch(() => caches.match('/'))
    );
    return;
  }

  // Hashed build assets are immutable: cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Never cache unhashed scripts, Vite dev modules or source files (serving them stale mixes React hashes)
  if (
    req.destination === 'script' ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/components/') ||
    url.pathname.startsWith('/services/') ||
    url.pathname.startsWith('/constants/') ||
    /\.(tsx?|jsx?|mjs)$/.test(url.pathname)
  ) return;

  // Static shell files (icons, manifest): stale-while-revalidate
  event.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

// ---------------------------------------------------------------- push notifications
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { notification: { body: event.data && event.data.text() } }; }
  const n = data.notification || {};
  const payload = data.data || {};
  event.waitUntil(self.registration.showNotification(n.title || 'NatureGram', {
    body: n.body || 'You have new activity',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'naturegram-activity',
    data: { url: payload.url || '/feed' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/feed';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) { await c.focus(); c.navigate(url).catch(() => {}); return; }
    }
    await self.clients.openWindow(url);
  })());
});
