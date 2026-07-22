const CACHE_NAME = 'naturegram-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/index.tsx',
  '/index.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Firebase Version Consitency: Intercept and normalize to 10.8.0
  if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) {
    const normalizedUrl = event.request.url.replace(/firebasejs\/(\d+\.\d+\.\d+)/, 'firebasejs/10.8.0');
    event.respondWith(fetch(normalizedUrl));
    return;
  }

  // Handle local scripts and module resolution
  if (url.origin === self.location.origin) {
    // Skip proxy paths
    if (url.pathname.startsWith('/api-proxy') || url.pathname.startsWith('/gemini-api-proxy')) {
      return;
    }

    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).catch(() => {
          // Fallback for /index.tsx if not found at absolute path
          if (url.pathname === '/index.tsx') return fetch('./index.tsx');
          throw new Error('Network error');
        });
      })
    );
    return;
  }

  // Standard fetch for everything else
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Web Push (FCM) — handled via the raw Push API rather than the Firebase
// Messaging compat SDK, since this is a general-purpose service worker
// (not a dedicated firebase-messaging-sw.js) and pulling in the compat
// library here would mean loading it for every user, not just those who
// opted into push.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    return;
  }

  const notification = payload.notification || {};
  const data = payload.data || {};

  event.waitUntil(
    self.registration.showNotification(notification.title || 'NatureGram', {
      body: notification.body || '',
      data: { postId: data.postId || '' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const postId = event.notification.data?.postId;
  const targetUrl = postId ? `/?post=${postId}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});