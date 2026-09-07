// Daybook service worker: push notifications + offline / instant-open caching.
//
// Caching rules, chosen to be safe:
//   - /api/* and /auth/* are NEVER cached - always straight to the network, so
//     data is fresh and the session token is honoured.
//   - Navigations (the app shell) are network-first, falling back to the cached
//     shell when offline, so the app still opens on the tube.
//   - Static assets (js/css/fonts/images) are stale-while-revalidate: served
//     from cache instantly, refreshed behind the scenes. Safe because every
//     asset URL carries a ?v=<cacheversion> stamp, so a new deploy is a new URL
//     (cache miss -> network) and a cached URL is byte-identical to its network
//     copy - no version can go stale under the same URL.
//
// Bump CACHE when this file's logic changes, to purge older caches on activate.

const CACHE = 'daybook-cache-v1';
const SHELL = ['/app.html', '/qrcode.min.js', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try { const c = await caches.open(CACHE); await c.addAll(SHELL); } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const STATIC_RE = /\.(?:js|mjs|css|woff2?|ttf|otf|png|svg|webmanifest|ico|jpe?g|webp|gif)$/i;
const isFontHost = (u) => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;   // only GETs are cacheable
  let url;
  try { url = new URL(req.url); } catch { return; }
  const sameOrigin = url.origin === self.location.origin;

  // Never touch the API or auth: always network, fresh and authenticated.
  if (sameOrigin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))) return;

  // The app shell (navigations): network-first, offline-fallback to cache.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        // Keep the latest shell for offline. The SPA serves /app.html for every
        // in-app route, so one cached copy covers them all.
        try { if (res && res.ok) { const c = await caches.open(CACHE); c.put('/app.html', res.clone()); } } catch {}
        return res;
      } catch {
        return (await caches.match('/app.html')) || Response.error();
      }
    })());
    return;
  }

  // Google Fonts: cache-first (immutable once fetched).
  if (isFontHost(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
        return res;
      } catch { return cached || Response.error(); }
    })());
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  if (sameOrigin && STATIC_RE.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const net = fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') { caches.open(CACHE).then((c) => c.put(req, res.clone())); }
        return res;
      }).catch(() => null);
      return cached || (await net) || Response.error();
    })());
    return;
  }

  // Everything else: leave it to the network (default behaviour).
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch {}
    // The number on the app icon. ONLY a push that actually carries a count may
    // touch it: connect and message pushes don't send one, and treating a missing
    // field as zero cleared the mail badge every time somebody said hello.
    try {
      if (typeof data.unread === 'number' && self.navigator && self.navigator.setAppBadge) {
        if (data.unread > 0) await self.navigator.setAppBadge(data.unread);
        else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
      }
    } catch {}

    // iOS requires every push to show a notification, or it revokes permission.
    // Where a tap should land: the payload's own target/url wins; mail keeps its
    // legacy default. (Connect requests send target:'contacts'.)
    const target = data.target || (data.type === 'mail' ? 'mail' : 'home');
    const url = data.url || (data.type === 'mail' ? '/mail' : '/');
    await self.registration.showNotification(data.title || 'Daybook', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.type === 'mail' ? 'robski-mail' : undefined,   // collapse repeats
      renotify: data.type === 'mail',
      data: { url, target },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // An app window is already open: DON'T navigate it (that reloads the whole
    // SPA and wipes the tab the user was on). Focus it and ask the app to open
    // the target in a NEW tab, so their current tabs stay exactly as they are.
    for (const c of all) {
      if ('focus' in c) { try { c.postMessage({ type: 'notification-open', target: d.target || 'home' }); } catch {} return c.focus(); }
    }
    // No window open at all - only then open one at the target.
    if (self.clients.openWindow) return self.clients.openWindow(d.url || '/');
  })());
});
