// Robski Life service worker. Its only job is push: when the worker sends a
// "new mail" push, badge the app icon and show a notification. No offline
// caching - the app is online-only and we don't want stale assets.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch {}
    const unread = Number(data.unread) || 0;

    // The number on the app icon.
    try {
      if (self.navigator && self.navigator.setAppBadge) {
        if (unread > 0) await self.navigator.setAppBadge(unread);
        else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
      }
    } catch {}

    // iOS requires every push to show a notification, or it revokes permission.
    await self.registration.showNotification(data.title || 'Robski Life', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.type === 'mail' ? 'robski-mail' : undefined,   // collapse repeats
      renotify: data.type === 'mail',
      data: { url: data.type === 'mail' ? '/mail' : '/', target: data.type === 'mail' ? 'mail' : 'home' },
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
