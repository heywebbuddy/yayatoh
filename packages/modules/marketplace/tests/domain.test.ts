import { describe, expect, it } from 'vitest';
import { frameAncestors, normalizeOrigin } from '../src/domain/embed.ts';
import { canonicalHostFor, isListable, isOnMarketplace } from '../src/domain/listing.ts';
import {
  followRedirectChain,
  MAX_REDIRECT_HOPS,
  normalizePath,
  pickRedirect,
  type RedirectRule,
  redirectLocation,
} from '../src/domain/redirects.ts';
import { dayRange, escapeLike, pageCount, parseSearchParams } from '../src/domain/search.ts';

const source = (
  over: Partial<{ status: string; visibility: string; profile: string; org: string }> = {},
) => ({
  event: {
    status: over.status ?? 'published',
    visibility: over.visibility ?? 'public',
    profile: over.profile ?? 'gala',
  },
  org: { status: over.org ?? 'active', primaryHost: 'x.yayatoh.events', primaryHostManaged: true },
  settings: { listOnMarketplace: true, tenantSite: false },
});

describe('listing rules (M1.11a)', () => {
  it('lists published and postponed public events of active orgs only', () => {
    expect(isListable(source())).toBe(true);
    expect(isListable(source({ status: 'postponed' }))).toBe(true);
    for (const status of ['draft', 'cancelled', 'completed', 'archived'])
      expect(isListable(source({ status }))).toBe(false);
    expect(isListable(source({ visibility: 'unlisted' }))).toBe(false);
    expect(isListable(source({ visibility: 'private' }))).toBe(false);
    expect(isListable(source({ org: 'suspended' }))).toBe(false);
    expect(isListable(source({ org: 'limited' }))).toBe(true);
  });

  it('keeps weddings and unenrolled orgs off the marketplace (D13)', () => {
    expect(isOnMarketplace(source())).toBe(true);
    expect(isOnMarketplace(source({ profile: 'wedding' }))).toBe(false);
    expect(isOnMarketplace({ ...source(), settings: { listOnMarketplace: false, tenantSite: true } })).toBe(
      false,
    );
  });

  it('canonical host: custom domain, else tenant subdomain with a tenant site, else apex', () => {
    const managed = { status: 'active', primaryHost: 'x.yayatoh.events', primaryHostManaged: true };
    const custom = { status: 'active', primaryHost: 'tickets.example.com', primaryHostManaged: false };
    expect(canonicalHostFor(managed, { listOnMarketplace: true, tenantSite: false })).toBeNull();
    expect(canonicalHostFor(managed, { listOnMarketplace: true, tenantSite: true })).toBe('x.yayatoh.events');
    expect(canonicalHostFor(custom, { listOnMarketplace: true, tenantSite: false })).toBe(
      'tickets.example.com',
    );
    expect(
      canonicalHostFor({ ...managed, primaryHost: null }, { listOnMarketplace: true, tenantSite: true }),
    ).toBeNull();
  });
});

describe('search parameters (M1.11a)', () => {
  it('drops invalid values instead of failing', () => {
    expect(
      parseSearchParams({
        q: '  jazz ',
        city: '',
        category: 'rave',
        price: 'cheap',
        from: '2027-13-40',
        page: '-3',
      }),
    ).toEqual({ q: 'jazz', page: 1 });
    expect(parseSearchParams({ page: ['2', '3'], price: 'free', category: 'concert' })).toEqual({
      page: 2,
      price: 'free',
      category: 'concert',
    });
  });

  it('drops an end before the start; day range covers whole days', () => {
    expect(parseSearchParams({ from: '2027-05-02', to: '2027-05-01' })).toMatchObject({ from: '2027-05-02' });
    expect(parseSearchParams({ from: '2027-05-02', to: '2027-05-01' }).to).toBeUndefined();
    const r = dayRange({ from: '2027-05-01', to: '2027-05-01' });
    expect(r.from?.toISOString()).toBe('2027-05-01T00:00:00.000Z');
    expect(r.to?.toISOString()).toBe('2027-05-02T00:00:00.000Z');
  });

  it('escapes LIKE wildcards; counts pages', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(pageCount(0)).toBe(1);
    expect(pageCount(13, 12)).toBe(2);
  });
});

describe('legacy redirects (M1.11b)', () => {
  const rules = [
    { source: '/organiser', match: 'prefix' as const, target: '/o', status: 308 },
    { source: '/organiser/special', match: 'exact' as const, target: '/o/vip', status: 301 },
    { source: '/login', match: 'exact' as const, target: '/sign-in', status: 308 },
  ];
  it('normalizes trailing slashes and picks exact before the longest prefix on a segment', () => {
    expect(normalizePath('/login/?x=1')).toBe('/login');
    expect(pickRedirect(rules, '/login/')?.target).toBe('/sign-in');
    expect(pickRedirect(rules, '/organiser/special')?.target).toBe('/o/vip');
    expect(pickRedirect(rules, '/organiser/acme')?.target).toBe('/o');
    expect(pickRedirect(rules, '/organisers')).toBeNull();
  });

  it('carries the rest of the path and the query string', () => {
    const [prefix] = rules;
    if (!prefix) throw new Error('rule');
    expect(redirectLocation(prefix, '/organiser/acme?ref=x')).toBe('/o/acme?ref=x');
    expect(redirectLocation(prefix, '/organiser')).toBe('/o');
    expect(redirectLocation({ ...prefix, match: 'exact', target: '/a?b=1' }, '/organiser?c=2')).toBe(
      '/a?b=1&c=2',
    );
  });
});

describe('embed origins (M1.11c)', () => {
  it('accepts https origins (and http://localhost), refuses paths, credentials and junk', () => {
    expect(normalizeOrigin('Shop.Example.com')).toBe('https://shop.example.com');
    expect(normalizeOrigin('https://shop.example.com/')).toBe('https://shop.example.com');
    expect(normalizeOrigin('https://shop.example.com:8443')).toBe('https://shop.example.com:8443');
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    for (const bad of [
      'http://shop.example.com',
      'https://shop.example.com/page',
      'https://u:p@x.com',
      'javascript:alert(1)',
      '',
      'https://10.0.0.1',
    ])
      expect(normalizeOrigin(bad)).toBeNull();
  });

  it('frame-ancestors lists the platform itself and the allowed origins only', () => {
    expect(frameAncestors([])).toBe("frame-ancestors 'self'");
    expect(frameAncestors(['https://a.com', 'https://b.com'])).toBe(
      "frame-ancestors 'self' https://a.com https://b.com",
    );
  });
});

describe('redirect chains (M2.4a: one hop, never a chain)', () => {
  const rules: RedirectRule[] = [
    { source: '/organiser', match: 'prefix', target: '/org', status: 301 },
    { source: '/org/harbor', match: 'exact', target: '/o/harbor-arts', status: 308 },
    { source: '/old-events', match: 'prefix', target: '/events', status: 308 },
    { source: '/loop-a', match: 'exact', target: '/loop-b', status: 308 },
    { source: '/loop-b', match: 'exact', target: '/loop-a', status: 308 },
    { source: '/away', match: 'exact', target: 'https://app.yayatoh.com/o/x', status: 308 },
    { source: '/h1', match: 'exact', target: '/h2', status: 301 },
    { source: '/h2', match: 'exact', target: '/h3', status: 308 },
    { source: '/h3', match: 'exact', target: '/h4', status: 308 },
    { source: '/h4', match: 'exact', target: '/h5', status: 308 },
    { source: '/h5', match: 'exact', target: '/h6', status: 308 },
    { source: '/h6', match: 'exact', target: '/h7', status: 308 },
  ];
  const match = (path: string) => pickRedirect(rules, path);

  it('follows a stored chain to the final URL with the first status and the query', async () => {
    expect(await followRedirectChain(match, '/organiser/harbor?utm=x')).toEqual({
      location: '/o/harbor-arts?utm=x',
      status: 301,
    });
    expect(await followRedirectChain(match, '/old-events/gala/')).toEqual({
      location: '/events/gala',
      status: 308,
    });
  });

  it('stops at an absolute URL, at a loop (no redirect) and after the hop limit', async () => {
    expect(await followRedirectChain(match, '/away')).toEqual({
      location: 'https://app.yayatoh.com/o/x',
      status: 308,
    });
    expect(await followRedirectChain(match, '/loop-a')).toBeNull();
    expect(await followRedirectChain(match, '/h1')).toEqual({
      location: `/h${1 + MAX_REDIRECT_HOPS}`,
      status: 301,
    });
    expect(await followRedirectChain(match, '/nothing')).toBeNull();
  });

  it('a single rule stays a single redirect', async () => {
    expect(await followRedirectChain(match, '/org/harbor')).toEqual({
      location: '/o/harbor-arts',
      status: 308,
    });
  });
});
