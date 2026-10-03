// Guest hub service worker (M4.7a): keeps the last copy of a party's hub page so it opens on the
// day even where the venue has no signal. Registered per party with the page's own path as its
// scope. Only that page (network first, the saved copy when offline) and Next's hashed static
// assets (cache first) are kept; every other request passes straight through. A link that no
// longer works (reset or expired: 404) drops the saved copy at once.
const CACHE = 'yy-hub-v1';
const HUB_PAGE = /^(\/[a-z]{2}(-[A-Z]{2})?)?\/hub\/[^/]+\/?$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('yy-hub-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

async function hubPage(request) {
  const url = new URL(request.url);
  const key = `${url.origin}${url.pathname}`;
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(key, res.clone());
    else if (res.status === 404 || res.status === 410) await cache.delete(key);
    return res;
  } catch {
    const saved = await cache.match(key);
    if (saved) return saved;
    return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}

async function staticAsset(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' && HUB_PAGE.test(url.pathname)) {
    event.respondWith(hubPage(req));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || /^\/hub-icon[\w-]*\.png$/.test(url.pathname))
    event.respondWith(staticAsset(req));
});
