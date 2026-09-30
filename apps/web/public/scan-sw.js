// Scan PWA service worker: keep the scanner shell usable offline. Only /scan pages and Next's
// hashed static assets are cached; every other request passes straight through.
const CACHE = 'yy-scan-v1';

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
