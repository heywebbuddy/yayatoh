// Conference hub service worker (M5.10a): keeps the last copy of a registrant's hub views (today,
// schedule, agenda, badge) so the badge and the schedule open at a venue with no signal.
// Registered per hub with the hub's own path as its scope. Only hub pages (network first, the
// saved copy when offline) and Next's hashed static assets (cache first) are kept; everything else
// (the calendar feed, actions, other pages) passes straight through. A link that no longer works
// (404) drops its saved copies.
const CACHE = 'yy-conference-hub-v1';
const HUB_PAGE = /^(\/[a-z]{2}(-[A-Z]{2})?)?\/orders\/[^/]+\/hub\/?$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('yy-conference-hub-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

async function hubPage(request) {
  const url = new URL(request.url);
  const key = `${url.origin}${url.pathname}${url.search}`;
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(key, res.clone());
    else if (res.status === 404 || res.status === 410)
      for (const k of await cache.keys()) if (new URL(k.url).pathname === url.pathname) await cache.delete(k);
    return res;
  } catch {
    const saved = (await cache.match(key)) ?? (await cache.match(`${url.origin}${url.pathname}`));
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
  if (
    url.pathname.startsWith('/_next/static/') ||
    /^\/conference-hub-icon[\w-]*\.(png|svg)$/.test(url.pathname)
  )
    event.respondWith(staticAsset(req));
});
