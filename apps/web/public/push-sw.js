// Web push service worker (M1.10e). Registered with the scope /push/ so it never controls a page
// (the scanner's worker keeps /). It only shows notifications: the payload is the server's
// allowlist (title, body, a link on this origin, tag, lang, dir), and a click opens that link.
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

function notificationFrom(data) {
  if (!data || typeof data.title !== 'string' || !data.title) return null;
  return {
    title: data.title.slice(0, MAX_TITLE),
    options: {
      body: typeof data.body === 'string' ? data.body.slice(0, MAX_BODY) : '',
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 64) : undefined,
      lang: typeof data.lang === 'string' ? data.lang.slice(0, 10) : undefined,
      dir: data.dir === 'rtl' ? 'rtl' : 'ltr',
      data: { url: data.url ? sameOriginUrl(data.url) : `${self.location.origin}/` },
    },
  };
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  const n = notificationFrom(data);
  if (!n) return;
  event.waitUntil(self.registration.showNotification(n.title, n.options));
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
