import { LOCALES } from '@yayatoh/contracts';
import { describe, expect, it } from 'vitest';
import {
  apexHost,
  bareHost,
  classifyHost,
  indexable,
  originFor,
  parseTenantReturn,
  sessionHostAccepted,
} from '../src/lib/hosts.ts';
import { decimalPrice, EventJsonLdSchema, eventJsonLd, jsonLdScript } from '../src/lib/seo/jsonld.ts';
import { isPrivatePage, NOINDEX, robotsHeader, robotsMeta, robotsTxt } from '../src/lib/seo/robots.ts';
import { latest, localeSitemapXml, sitemapIndexXml } from '../src/lib/seo/sitemap.ts';
import { hreflangAlternates, localizedPath, pageAlternates } from '../src/lib/seo/urls.ts';
import { widgetSnippet } from '../src/lib/widget.ts';

describe('hosts (M1.11a)', () => {
  it('strips ports and case; classifies marketplace, app, dev and tenant hosts', () => {
    expect(bareHost('YayaToh.com:443')).toBe('yayatoh.com');
    expect(bareHost('[::1]:3000')).toBe('[::1]');
    expect(bareHost('shop.example.com.')).toBe('shop.example.com');
    const env = {};
    expect(classifyHost('yayatoh.com', env)).toBe('marketplace');
    expect(classifyHost('www.yayatoh.com', env)).toBe('marketplace');
    expect(classifyHost('yayatoh.localhost', env)).toBe('marketplace');
    expect(classifyHost('app.yayatoh.com', env)).toBe('app');
    expect(classifyHost('localhost', env)).toBe('dev');
    expect(classifyHost('pr-12.vercel.app', env)).toBe('dev');
    expect(classifyHost('lakeside.yayatoh.events', env)).toBe('tenant');
    expect(classifyHost('abc.yayatoh.com', env)).toBe('tenant');
    expect(classifyHost('shop.test', { MARKETPLACE_HOSTS: 'shop.test' })).toBe('marketplace');
    expect(apexHost(env)).toBe('yayatoh.com');
  });

  it('builds origins with the request scheme and port; only public hosts are indexable', () => {
    expect(originFor({ protocol: 'https:', host: 'yayatoh.com', port: '' }, 'x.yayatoh.events')).toBe(
      'https://x.yayatoh.events',
    );
    expect(originFor({ protocol: 'http:', host: 'localhost', port: '3100' }, 'yayatoh.localhost')).toBe(
      'http://yayatoh.localhost:3100',
    );
    expect(['marketplace', 'tenant', 'app', 'dev'].map((k) => indexable(k as 'app'))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('canonical and hreflang (M1.11b)', () => {
  it('uses as-needed locale prefixes', () => {
    expect(localizedPath('en', '/')).toBe('/');
    expect(localizedPath('en', '/events/x')).toBe('/events/x');
    expect(localizedPath('ar', '/')).toBe('/ar');
    expect(localizedPath('fr', 'events/x')).toBe('/fr/events/x');
  });

  it('lists all 13 locales plus x-default, absolute', () => {
    const alt = hreflangAlternates('https://yayatoh.com', '/events/x');
    expect(Object.keys(alt)).toHaveLength(LOCALES.length + 1);
    expect(alt.ar).toBe('https://yayatoh.com/ar/events/x');
    expect(alt['x-default']).toBe('https://yayatoh.com/events/x');
    expect(Object.values(alt).every((u) => u.startsWith('https://'))).toBe(true);
    expect(pageAlternates('https://x.yayatoh.events', 'de', '/').canonical).toBe(
      'https://x.yayatoh.events/de',
    );
  });
});

describe('sitemaps and robots (M1.11b)', () => {
  const pages = [
    { path: '/', lastmod: null },
    { path: '/events/a&b', lastmod: new Date('2027-01-02T03:04:05Z') },
  ];
  it('indexes one sitemap per locale with the latest lastmod', () => {
    const xml = sitemapIndexXml('https://yayatoh.com', latest(pages));
    expect(xml.match(/<sitemap>/g)).toHaveLength(LOCALES.length);
    expect(xml).toContain('<loc>https://yayatoh.com/sitemaps/ar.xml</loc>');
    expect(xml).toContain('<lastmod>2027-01-02T03:04:05.000Z</lastmod>');
  });

  it('writes escaped locale URLs with hreflang alternates', () => {
    const xml = localeSitemapXml('https://yayatoh.com', 'ar', pages);
    expect(xml).toContain('<loc>https://yayatoh.com/ar/events/a&amp;b</loc>');
    expect(xml).toContain('hreflang="x-default" href="https://yayatoh.com/events/a&amp;b"');
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it('robots: public hosts allow and point at their sitemap; dashboard and dev hosts disallow all', () => {
    const pub = robotsTxt('tenant', 'https://x.yayatoh.events');
    expect(pub).toContain('Allow: /');
    expect(pub).toContain('Disallow: /checkout/');
    // The console and secret-link pages (M1.14a), but not the public org page `/o/{slug}`.
    for (const p of ['/o/*/', '/orders/', '/my-tickets/', '/claim/', '/invite/', '/api/'])
      expect(pub).toContain(`Disallow: ${p}\n`);
    expect(pub).not.toContain('Disallow: /o/\n');
    expect(pub).toContain('Sitemap: https://x.yayatoh.events/sitemap.xml');
    expect(robotsTxt('app', 'https://app.yayatoh.com')).toBe('User-agent: *\nDisallow: /\n');
    expect(robotsTxt('dev', 'http://localhost:3000')).toContain('Disallow: /');
  });
});

describe('JSON-LD Event (M1.11b)', () => {
  const base = {
    name: 'Harbor Gala',
    description: 'A night by the water',
    status: 'published',
    startsAt: new Date('2027-06-10T22:00:00Z'),
    endsAt: new Date('2027-06-11T01:00:00Z'),
    venueName: 'Harbor Hall',
    city: 'Chicago',
    country: 'US',
    url: 'https://yayatoh.com/events/harbor-gala',
    image: 'https://yayatoh.com/api/og/event/harbor-gala',
    organizer: { name: 'Lakeside Events', url: 'https://yayatoh.com/o/lakeside-events' },
    offers: [{ name: 'GA', priceMinor: 2575, currency: 'USD', availability: 'available' as const }],
  };

  it('is valid, with a PostalAddress country code, absolute URLs and decimal prices', () => {
    const ld = EventJsonLdSchema.parse(eventJsonLd(base));
    expect(
      !Array.isArray(ld.location) && 'address' in ld.location && ld.location.address.addressCountry,
    ).toBe('US');
    expect(ld.offers?.[0]).toMatchObject({ price: '25.75', availability: 'https://schema.org/InStock' });
    expect(ld.eventStatus).toBe('https://schema.org/EventScheduled');
  });

  it('marks postponed and cancelled events; omits offers when none', () => {
    expect(eventJsonLd({ ...base, status: 'postponed' }).eventStatus).toBe(
      'https://schema.org/EventPostponed',
    );
    const c = eventJsonLd({ ...base, status: 'cancelled', offers: [] });
    expect(c.eventStatus).toBe('https://schema.org/EventCancelled');
    expect('offers' in c).toBe(false);
  });

  it('online events get a VirtualLocation (the page URL); hybrid ones both (M1.4c)', () => {
    const online = EventJsonLdSchema.parse(eventJsonLd({ ...base, attendanceMode: 'online' }));
    expect(online.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode');
    expect(online.location).toEqual({ '@type': 'VirtualLocation', url: base.url });
    const hybrid = EventJsonLdSchema.parse(eventJsonLd({ ...base, attendanceMode: 'hybrid' }));
    expect(hybrid.eventAttendanceMode).toBe('https://schema.org/MixedEventAttendanceMode');
    expect(Array.isArray(hybrid.location) && hybrid.location.map((l) => l['@type'])).toEqual([
      'Place',
      'VirtualLocation',
    ]);
    expect(EventJsonLdSchema.parse(eventJsonLd(base)).eventAttendanceMode).toBe(
      'https://schema.org/OfflineEventAttendanceMode',
    );
  });

  it('rejects relative images and numeric countries (the legacy defects)', () => {
    expect(EventJsonLdSchema.safeParse(eventJsonLd({ ...base, image: '/og.png' })).success).toBe(false);
    expect(EventJsonLdSchema.safeParse(eventJsonLd({ ...base, country: '231' })).success).toBe(false);
  });

  it('formats zero-decimal currencies and escapes script-closing text', () => {
    expect(decimalPrice(1500, 'JPY')).toBe('1500');
    expect(decimalPrice(5, 'USD')).toBe('0.05');
    expect(jsonLdScript({ name: '</script><b>' })).not.toContain('</script>');
  });
});

describe('ticket widget snippet (M1.11c)', () => {
  it('embeds the event with an escaped title and the resizing loader', () => {
    const s = widgetSnippet('https://yayatoh.com', 'harbor-gala', 'Tickets: "Gala" <2027>');
    expect(s).toContain('<iframe src="https://yayatoh.com/embed/harbor-gala"');
    expect(s).toContain('title="Tickets: &quot;Gala&quot; &lt;2027>"');
    expect(s).toContain('data-yayatoh-widget');
    expect(s).toContain('<script src="https://yayatoh.com/widget.js" async></script>');
  });
});

describe('central login hosts (M1.2d)', () => {
  const env = { MARKETPLACE_HOSTS: 'yayatoh.com,yayatoh.localhost', APP_HOSTS: 'app.yayatoh.com' };

  it('accepts a session only on the host it was issued for', () => {
    expect(sessionHostAccepted('harbor.yayatoh.events', 'harbor.yayatoh.events', 'tenant')).toBe(true);
    expect(sessionHostAccepted('harbor.yayatoh.events', 'lakeside.yayatoh.events', 'tenant')).toBe(false);
    expect(sessionHostAccepted('app.yayatoh.com', 'harbor.yayatoh.events', 'tenant')).toBe(false);
    expect(sessionHostAccepted('localhost:3100', 'localhost:3100', 'dev')).toBe(true);
    // Unbound sessions (API clients, older sessions): never on a tenant host.
    expect(sessionHostAccepted(null, 'harbor.yayatoh.events', 'tenant')).toBe(false);
    expect(sessionHostAccepted(null, 'app.yayatoh.com', 'app')).toBe(true);
  });

  it('takes only tenant return URLs with the app’s scheme and port', () => {
    const app = 'https://app.yayatoh.com';
    expect(parseTenantReturn('https://harbor.yayatoh.events/events/gala?x=1', app, env)).toEqual({
      origin: 'https://harbor.yayatoh.events',
      host: 'harbor.yayatoh.events',
      hostname: 'harbor.yayatoh.events',
      path: '/events/gala?x=1',
    });
    expect(parseTenantReturn('http://harbor.yayatoh.events/', app, env)).toBeNull();
    expect(parseTenantReturn('https://app.yayatoh.com/o', app, env)).toBeNull();
    expect(parseTenantReturn('https://yayatoh.com/', app, env)).toBeNull();
    expect(parseTenantReturn('https://user:pw@harbor.yayatoh.events/', app, env)).toBeNull();
    expect(parseTenantReturn('https://harbor.yayatoh.events:8443/', app, env)).toBeNull();
    expect(parseTenantReturn('javascript:alert(1)', app, env)).toBeNull();
    expect(parseTenantReturn('/relative', app, env)).toBeNull();
    const dev = 'http://localhost:3100';
    expect(parseTenantReturn('http://harbor.yayatoh.events:3100/', dev, env)?.host).toBe(
      'harbor.yayatoh.events:3100',
    );
    expect(parseTenantReturn('http://localhost:3100/', dev, env)).toBeNull();
  });
});

describe('noindex guard (M1.11d)', () => {
  const PUBLIC = [
    '/',
    '/events',
    '/events/gala',
    '/events/gala/seat-finder',
    '/series/tour',
    '/venues',
    '/venues/hall',
    '/legal/lakeside/refund',
    '/privacy',
    '/sub-processors',
    '/robots.txt',
    '/sitemap.xml',
  ];
  const PRIVATE = [
    '/o/lakeside/settings',
    '/o/lakeside/e/gala/attendees',
    '/o',
    '/sign-in',
    '/signup',
    '/checkout/fake',
    '/my-tickets/tok',
    '/orders/tok',
    '/orders/tok/pdf',
    '/claim/tok',
    '/invite/tok',
    '/portal/gala',
    '/connect/fake',
    '/scan',
    '/embed/gala',
    '/events/gala/unlock',
    '/messages/tok',
    '/unsubscribe/tok',
    '/account/security',
    '/dev/login',
    '/t/org-id',
    '/organizers/lakeside',
  ];

  it('public pages on public hosts send no noindex header; private pages always do', () => {
    for (const kind of ['marketplace', 'tenant'] as const) {
      for (const p of PUBLIC) expect([kind, p, robotsHeader(kind, p)]).toEqual([kind, p, null]);
      for (const p of PRIVATE) expect([kind, p, robotsHeader(kind, p)]).toEqual([kind, p, NOINDEX]);
    }
  });

  it('the organizer page /o/{slug} is public on the marketplace only (elsewhere it is the console)', () => {
    expect(isPrivatePage('marketplace', '/o/lakeside')).toBe(false);
    expect(isPrivatePage('marketplace', '/o/lakeside/')).toBe(false);
    expect(isPrivatePage('tenant', '/o/lakeside')).toBe(true);
    expect(isPrivatePage('dev', '/o/lakeside')).toBe(true);
  });

  it('dashboard, localhost and preview hosts are noindex on every page, header and meta', () => {
    for (const kind of ['app', 'dev'] as const) {
      for (const p of [...PUBLIC, ...PRIVATE]) expect(robotsHeader(kind, p)).toBe(NOINDEX);
      expect(robotsMeta(kind)).toEqual({ index: false, follow: true });
    }
    expect(classifyHost('pr-42-yayatoh.vercel.app', {})).toBe('dev');
  });

  it('public metadata indexes on public hosts unless the page opts out (unlisted, finished)', () => {
    expect(robotsMeta('marketplace')).toEqual({ index: true, follow: true });
    expect(robotsMeta('tenant')).toEqual({ index: true, follow: true });
    expect(robotsMeta('tenant', false)).toEqual({ index: false, follow: true });
  });
});
