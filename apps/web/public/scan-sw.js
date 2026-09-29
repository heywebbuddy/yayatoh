// Scan PWA service worker: keep the scanner shell usable offline. Only /scan pages and Next's
// hashed static assets are cached; every other request passes straight through. Since M3.4a it
// also shows staff alerts (web push, opted in per device from staff mode): the payload is the
// server's allowlist (title, body, a link on this origin, tag, lang, dir); a click opens the scanner.
const CACHE = 'yy-scan-v1';
const MAX_TITLE = 120;
const MAX_BODY = 600;

/** A link on this origin, else the site root (never navigate off-site from a notification). */
function sameOriginUrl(value) {
  try {
    const url = new URL(String(value), self.location.origin);
    return url.origin === self.location.origin ? url.href : `${self.location.origin}/`;
  } catch {
    return `${self.location.origin}/`;
  }
}

self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || typeof data.title !== 'string' || !data.title) return;
  event.waitUntil(
    self.registration.showNotification(data.title.slice(0, MAX_TITLE), {
      body: typeof data.body === 'string' ? data.body.slice(0, MAX_BODY) : '',
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 64) : undefined,
      lang: typeof data.lang === 'string' ? data.lang.slice(0, 10) : undefined,
      dir: data.dir === 'rtl' ? 'rtl' : 'ltr',
      data: { url: data.url ? sameOriginUrl(data.url) : `${self.location.origin}/` },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOriginUrl(event.notification.data?.url ?? '/');
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = open.find((c) => c.url === url);
      if (same) return same.focus();
      return self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isScanPage = req.mode === 'navigate' && /\/scan\/?$/.test(url.pathname);
  const isStatic = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/scan');
  if (!isScanPage && !isStatic) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isScanPage) {
        // Network first for the page (fresh deploys), cache as the offline fallback.
        try {
          const res = await fetch(req);
          if (res.ok) await cache.put(req, res.clone());
          return res;
        } catch {
          return (await cache.match(req)) ?? Response.error();
        }
      }
      // Hashed assets never change: cache first.
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })(),
  );
});
