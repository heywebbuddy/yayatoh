import { describe, expect, it } from 'vitest';
import {
  decideFrontDoor,
  type FlagStates,
  FRONT_DOOR_ROUTES,
  flagKey,
  forwardRequestHeaders,
  forwardResponseHeaders,
  frontDoorConfig,
  frontDoorHostList,
  isNewAppCookie,
  isPlatformPath,
  legacyCookieHeader,
  matchFrontDoorRoute,
  parseOrigin,
  publicLocation,
  ROUTE_TABLE_VERSION,
  type RouteState,
  scopeSetCookie,
  stripFrontDoorLocale,
} from '../src/front-door/index.ts';

const HOST = 'yayatoh.com';
const flags = (entries: Record<string, RouteState> = {}): FlagStates =>
  new Map(Object.entries(entries).map(([route, state]) => [flagKey(HOST, route), state]));
const decide = (
  path: string,
  f: FlagStates = flags(),
  o: { canary?: boolean; legacy?: boolean; instance?: 'yay' | 'abc'; host?: string } = {},
) => {
  const u = new URL(path, 'https://x');
  return decideFrontDoor({
    instance: o.instance ?? 'yay',
    host: o.host ?? HOST,
    path: u.pathname,
    query: u.searchParams,
    flags: f,
    overrides: { canary: o.canary ?? false, legacy: o.legacy ?? false },
  });
};

describe('route table (M2.4a)', () => {
  it('is versioned, with unique keys and only read surfaces', () => {
    expect(ROUTE_TABLE_VERSION).toBe(2);
    const keys = FRONT_DOOR_ROUTES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'home',
      'events.search',
      'events.listing',
      'events.page',
      'organizers.page',
      'venues.page',
      'content.blogs',
      'content.pages',
      'seo.robots',
      'seo.sitemaps',
      'site.pricing',
      'site.features',
      'site.contact',
      'help.center',
      'site.status',
    ]);
    for (const r of FRONT_DOOR_ROUTES) expect(r.key).toMatch(/^[a-z][a-z0-9.]*$/);
  });

  it.each([
    ['/', 'home'],
    ['/events', 'events.listing'],
    ['/events?page=2', 'events.listing'],
    ['/events?q=jazz', 'events.search'],
    ['/events?search=jazz', 'events.search'],
    ['/events?city=Chicago', 'events.search'],
    ['/events/summer-gala', 'events.page'],
    ['/o/harbor-arts', 'organizers.page'],
    ['/o/harbor-arts/blogs', 'organizers.page'],
    ['/o/harbor-arts/blogs/opening-night', 'organizers.page'],
    ['/o/harbor-arts/pages/about', 'organizers.page'],
    ['/venues/lakeside', 'venues.page'],
    ['/blogs', 'content.blogs'],
    ['/blogs/hello', 'content.blogs'],
    ['/pages/about-us', 'content.pages'],
    ['/robots.txt', 'seo.robots'],
    ['/sitemap.xml', 'seo.sitemaps'],
    ['/sitemaps/events-1.xml', 'seo.sitemaps'],
  ])('%s is the %s route', (path, key) => {
    const u = new URL(path, 'https://x');
    expect(matchFrontDoorRoute('yay', u.pathname, u.searchParams)?.key).toBe(key);
  });

  it.each([
    '/events/summer-gala/attendee',
    '/events/summer-gala/checkout',
    '/events/summer-gala/tag_vip',
    '/o/harbor-arts/e/dashboard',
    '/login',
    '/register',
    '/storage/banner.jpg',
    '/harbor-arts',
    '/e/abc123',
    '/stripe/webhook',
  ])('%s is not moved (legacy keeps it)', (path) => {
    expect(matchFrontDoorRoute('yay', path, new URLSearchParams())).toBeNull();
  });

  it('abc has no marketplace listing, search, organizer or venue pages', () => {
    for (const p of ['/events', '/o/abc', '/venues/hall'])
      expect(matchFrontDoorRoute('abc', p, new URLSearchParams())).toBeNull();
    expect(matchFrontDoorRoute('abc', '/', new URLSearchParams())?.key).toBe('home');
    expect(matchFrontDoorRoute('abc', '/events/gala', new URLSearchParams())?.key).toBe('events.page');
  });

  it('v2: the M3.11 public pages are moved routes on the marketplace host only', () => {
    const q = new URLSearchParams();
    expect(matchFrontDoorRoute('yay', '/pricing', q)?.key).toBe('site.pricing');
    expect(matchFrontDoorRoute('yay', '/features', q)?.key).toBe('site.features');
    expect(matchFrontDoorRoute('yay', '/contact', q)?.key).toBe('site.contact');
    expect(matchFrontDoorRoute('yay', '/status', q)?.key).toBe('site.status');
    for (const p of ['/help', '/help/search', '/help/organizers', '/help/organizers/payouts'])
      expect(matchFrontDoorRoute('yay', p, q)?.key).toBe('help.center');
    expect(matchFrontDoorRoute('yay', '/help/a/b/c', q)).toBeNull();
    for (const p of ['/pricing', '/features', '/contact', '/status', '/help'])
      expect(matchFrontDoorRoute('abc', p, q)).toBeNull();
    // Like every moved route, they stay on legacy until a flag moves them.
    expect(decide('/pricing')).toMatchObject({ owner: 'legacy', route: 'site.pricing' });
    expect(decide('/ar/help/organizers', flags({ 'help.center': 'next' }))).toMatchObject({
      owner: 'next',
      route: 'help.center',
    });
  });

  it('strips the new app’s locale prefix and trailing slashes for matching', () => {
    expect(stripFrontDoorLocale('/ar/events/x/')).toEqual({ locale: 'ar', rest: '/events/x' });
    expect(stripFrontDoorLocale('/ar')).toEqual({ locale: 'ar', rest: '/' });
    expect(stripFrontDoorLocale('/zh-TW/blogs')).toEqual({ locale: 'zh-TW', rest: '/blogs' });
    expect(stripFrontDoorLocale('/events/')).toEqual({ locale: null, rest: '/events' });
    expect(stripFrontDoorLocale('/xx/events')).toEqual({ locale: null, rest: '/xx/events' });
  });
});

describe('who serves a request', () => {
  it('everything unmoved goes to legacy; moved routes default to legacy', () => {
    expect(decide('/login')).toEqual({ owner: 'legacy', route: 'legacy', reason: 'unowned' });
    expect(decide('/events')).toEqual({ owner: 'legacy', route: 'events.listing', reason: 'flag' });
  });

  it('a flag moves one route on one host only', () => {
    const f = flags({ 'events.listing': 'next' });
    expect(decide('/events', f)).toEqual({ owner: 'next', route: 'events.listing', reason: 'flag' });
    expect(decide('/ar/events/', f).owner).toBe('next');
    expect(decide('/events?q=jazz', f).owner).toBe('legacy');
    expect(decide('/events/gala', f).owner).toBe('legacy');
    expect(decide('/events', f, { host: 'www.yayatoh.com' }).owner).toBe('legacy');
    expect(decide('/events', f, { host: 'abc.yayatoh.com', instance: 'abc' }).owner).toBe('legacy');
  });

  it('canary routes need the yy_canary cookie; yy_legacy forces legacy', () => {
    const f = flags({ 'events.page': 'canary', home: 'next' });
    expect(decide('/events/gala', f).owner).toBe('legacy');
    expect(decide('/events/gala', f, { canary: true })).toEqual({
      owner: 'next',
      route: 'events.page',
      reason: 'canary',
    });
    expect(decide('/', f, { legacy: true })).toEqual({ owner: 'legacy', route: 'home', reason: 'override' });
  });

  it('a flag naming a route the table no longer has changes nothing', () => {
    const f = new Map([[flagKey(HOST, 'events.retired'), 'next' as const]]);
    expect(decide('/events/retired', f).owner).toBe('legacy');
  });

  it('the new app’s own paths are never forwarded, whatever the cookies or flags', () => {
    for (const p of [
      '/api/v2/events',
      '/api/v2',
      '/api/v1/orgs/x',
      // Batch 3d merge: M3.5b's provider webhooks and M3.4a's staff mode endpoints.
      '/api/webhooks/email/ses',
      '/api/webhooks/sms/twilio',
      '/api/webhooks/sms/twilio/inbound',
      '/api/webhooks/whatsapp/whatsapp_cloud',
      '/api/scan/staff',
      '/api/command-center/org/event/sales',
      '/_next/static/chunk.js',
      '/media/org/file.webp',
      '/embed/gala',
      '/widget.js',
      '/sign-in',
      '/auth/start',
      '/my-tickets',
      '/ar/sign-in',
      // Batch 3e merge: emailed links and the new registration pages.
      '/unsubscribe/abc~sig',
      '/r/AbC123',
      '/waitlist/abc~sig',
      '/registration-form/abc~sig',
      '/events/summit/register',
      '/events/summit/registration-form',
      '/ar/events/summit/register',
      // Batch 3f merge: the portal and the public exhibitor map.
      '/event-portal',
      '/event-portal/invite/token',
      '/event-portal/verify/token',
      '/event-portal/sign-in/site',
      '/fr/event-portal',
      '/events/summit/exhibitors',
      // Batch 3g merge: TV display links, the seat finder and its guest help pages, the Scan PWA's
      // help requests and the Command Center's presence ping.
      '/tv/abc~sig',
      '/ar/tv/abc~sig',
      '/events/summit/seat-finder',
      '/events/summit/seat-finder/help',
      '/events/summit/seat-finder/help/abc~sig',
      '/ar/events/summit/seat-finder/help',
      '/api/scan/assistance',
      '/api/tv/abc~sig',
      '/api/command-center/org/event/presence',
      // M5.1c: group registration, the applicant's page, the payer's group page.
      '/events/summit/register/group',
      '/events/summit/registration/abc~sig',
      '/events/summit/group/abc~sig',
    ]) {
      expect(isPlatformPath(new URL(p, 'https://x').pathname) || decide(p).owner === 'next').toBe(true);
      expect(decide(p, flags(), { legacy: true })).toEqual({
        owner: 'next',
        route: 'platform',
        reason: 'platform',
      });
    }
    expect(isPlatformPath('/apiary')).toBe(false);
    expect(isPlatformPath('/sign-instructions')).toBe(false);
    // The event page itself and its other sub-paths stay with the route table.
    expect(isPlatformPath('/events/summit')).toBe(false);
    expect(isPlatformPath('/events/summit/attendee')).toBe(false);
    expect(isPlatformPath('/events/summit/seat-finder/help/a/b')).toBe(false);
    expect(isPlatformPath('/tvguide')).toBe(false);
    expect(isPlatformPath('/events/summit/group')).toBe(false);
  });
});

describe('configuration', () => {
  it('is off without a legacy origin, per instance otherwise', () => {
    expect(frontDoorConfig({}).hosts.size).toBe(0);
    const c = frontDoorConfig({ LEGACY_ORIGIN_URL: 'https://origin-yay.yayatoh.com' });
    expect([...c.hosts.keys()]).toEqual(['yayatoh.com', 'www.yayatoh.com']);
    expect(c.hosts.get('yayatoh.com')).toEqual({ instance: 'yay', origin: 'https://origin-yay.yayatoh.com' });
    const both = frontDoorConfig({
      LEGACY_ORIGIN_URL: 'https://origin-yay.yayatoh.com/',
      LEGACY_ABC_ORIGIN_URL: 'https://origin-abc.yayatoh.com',
      LEGACY_ORIGIN_SECRET: ' s3cret ',
      FRONT_DOOR_TIMEOUT_MS: '150000',
    });
    expect(both.hosts.get('abc.yayatoh.com')?.origin).toBe('https://origin-abc.yayatoh.com');
    expect(both.secret).toBe('s3cret');
    expect(both.timeoutMs).toBe(150_000);
    expect(both.maxBody).toBe(64 * 1024 * 1024);
    expect(frontDoorConfig({ FRONT_DOOR_MAX_BODY: '10' }).maxBody).toBe(64 * 1024 * 1024);
    expect(frontDoorConfig({ FRONT_DOOR_MAX_BODY: String(30 * 1024 * 1024) }).maxBody).toBe(30 * 1024 * 1024);
    expect(frontDoorHostList({ LEGACY_ABC_ORIGIN_URL: 'https://o.test' })).toEqual([
      { host: 'yayatoh.com', instance: 'yay', configured: false },
      { host: 'www.yayatoh.com', instance: 'yay', configured: false },
      { host: 'abc.yayatoh.com', instance: 'abc', configured: true },
    ]);
  });

  it('refuses origins with paths, credentials or other schemes', () => {
    expect(parseOrigin('https://user:pw@origin.test')).toBeNull();
    expect(parseOrigin('https://origin.test/app')).toBeNull();
    expect(parseOrigin('ftp://origin.test')).toBeNull();
    expect(parseOrigin('not a url')).toBeNull();
    expect(parseOrigin('http://127.0.0.1:3390')).toBe('http://127.0.0.1:3390');
  });
});

describe('what crosses the boundary', () => {
  const ctx = {
    host: HOST,
    hostHeader: HOST,
    proto: 'https' as const,
    clientIp: '203.0.113.9',
    secret: 'origin-secret',
  };

  it('request: hop-by-hop, client proxy headers and the new app’s cookies stay behind', () => {
    const h = forwardRequestHeaders(
      new Headers({
        connection: 'keep-alive, x-custom-hop',
        'keep-alive': 'timeout=5',
        'x-custom-hop': '1',
        upgrade: 'websocket',
        te: 'trailers',
        expect: '100-continue',
        'transfer-encoding': 'chunked',
        'proxy-authorization': 'Basic x',
        'x-forwarded-for': '6.6.6.6',
        'x-forwarded-host': 'evil.example',
        'x-real-ip': '6.6.6.6',
        'x-yayatoh-front-door': 'forged',
        'x-middleware-subrequest': 'x',
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
        cookie:
          'yayatoh_session=abc; XSRF-TOKEN=t; __Host-yy.session=s; yy.session=s; yy_did=d; yy_canary=next; NEXT_LOCALE=ar',
      }),
      ctx,
    );
    const names = [...h.keys()];
    for (const n of [
      'connection',
      'keep-alive',
      'x-custom-hop',
      'upgrade',
      'te',
      'transfer-encoding',
      'expect',
    ])
      expect(names).not.toContain(n);
    expect(names).not.toContain('proxy-authorization');
    expect(names).not.toContain('x-middleware-subrequest');
    expect(h.get('cookie')).toBe('yayatoh_session=abc; XSRF-TOKEN=t');
    expect(h.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(h.get('x-real-ip')).toBe('203.0.113.9');
    expect(h.get('x-forwarded-host')).toBe(HOST);
    expect(h.get('x-forwarded-proto')).toBe('https');
    expect(h.get('x-yayatoh-front-door')).toBe('origin-secret');
    expect(h.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(h.get('accept')).toBe('text/html');
  });

  it('request: no cookie header when only the new app’s cookies were sent', () => {
    expect(legacyCookieHeader('yy.session=s; NEXT_LOCALE=en')).toBeNull();
    const h = forwardRequestHeaders(new Headers({ cookie: '__Host-yy.session=s' }), { ...ctx, secret: null });
    expect(h.has('cookie')).toBe(false);
    expect(h.has('x-yayatoh-front-door')).toBe(false);
  });

  it('knows the new app’s cookie names', () => {
    for (const n of [
      '__Host-yy.session',
      'yy.session',
      'yy.oauth',
      'yy-admin.session',
      'yy_did',
      'yy_legacy',
      'NEXT_LOCALE',
    ])
      expect(isNewAppCookie(n), n).toBe(true);
    for (const n of ['yayatoh_session', 'XSRF-TOKEN', 'remember_web_59ba36', 'laravel_session', 'yyz'])
      expect(isNewAppCookie(n), n).toBe(false);
  });

  it('response: cookies lose Domain (host-only) and may not shadow the new app’s', () => {
    expect(scopeSetCookie('legacy_session=x; Domain=.yayatoh.com; Path=/; HttpOnly')).toBe(
      'legacy_session=x; Path=/; HttpOnly',
    );
    expect(scopeSetCookie('XSRF-TOKEN=t;domain=yayatoh.com;path=/')).toBe('XSRF-TOKEN=t; path=/');
    expect(scopeSetCookie('yy.session=forged; Path=/')).toBeNull();
    expect(scopeSetCookie('__Host-yy.session=forged; Path=/; Secure')).toBeNull();
    const h = new Headers();
    h.append('set-cookie', 'a=1; Domain=.yayatoh.com');
    h.append('set-cookie', 'NEXT_LOCALE=fr; Path=/');
    h.append('location', 'https://origin-yay.yayatoh.com/login?next=%2F');
    h.append('content-encoding', 'gzip');
    h.append('transfer-encoding', 'chunked');
    h.append('connection', 'close');
    h.append('cache-control', 'private');
    const out = forwardResponseHeaders(h, {
      origin: 'https://origin-yay.yayatoh.com',
      publicOrigin: 'https://yayatoh.com',
      decoded: true,
    });
    expect(out.getSetCookie()).toEqual(['a=1']);
    expect(out.get('location')).toBe('https://yayatoh.com/login?next=%2F');
    expect(out.has('content-encoding')).toBe(false);
    expect(out.has('transfer-encoding')).toBe(false);
    expect(out.has('connection')).toBe(false);
    expect(out.get('cache-control')).toBe('private');
  });

  it('redirects elsewhere are left alone', () => {
    expect(
      publicLocation('https://accounts.google.com/o', 'https://origin.test', 'https://yayatoh.com'),
    ).toBe('https://accounts.google.com/o');
    expect(publicLocation('/dashboard', 'https://origin.test', 'https://yayatoh.com')).toBe(
      'https://yayatoh.com/dashboard',
    );
  });
});
