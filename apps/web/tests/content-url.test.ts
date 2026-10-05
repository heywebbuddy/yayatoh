import { describe, expect, it } from 'vitest';
import { type ContentRequest, contentHomeFor, contentUrlFor, organizerBase } from '../src/lib/content-url.ts';
import { classifyHost } from '../src/lib/hosts.ts';

const req = (host: string, protocol: 'http:' | 'https:' = 'https:', port = ''): ContentRequest => ({
  kind: classifyHost(host),
  host,
  protocol,
  port,
  origin: `${protocol}//${host}${port ? `:${port}` : ''}`,
});

const opts = { apexHost: 'yayatoh.com', isContentOrg: false };
const noSite = { slug: 'lakeside', tenantSite: false, primaryHost: null };
const subdomain = { slug: 'lakeside', tenantSite: true, primaryHost: 'lakeside.yayatoh.events' };
const custom = { slug: 'lakeside', tenantSite: true, primaryHost: 'tickets.lakeside.example' };

describe('content public URLs per host class (U3)', () => {
  it('managed subdomain: the tenant site at root paths, from any host', () => {
    expect(contentUrlFor(req('app.yayatoh.com'), subdomain, 'post', 'hello', opts)).toBe(
      'https://lakeside.yayatoh.events/blogs/hello',
    );
    expect(contentUrlFor(req('lakeside.yayatoh.events'), subdomain, 'page', 'about', opts)).toBe(
      'https://lakeside.yayatoh.events/pages/about',
    );
  });

  it('custom domain: the custom host at root paths, keeping the local port', () => {
    expect(contentUrlFor(req('localhost', 'http:', '3100'), custom, 'post', 'hello', opts)).toBe(
      'http://tickets.lakeside.example:3100/blogs/hello',
    );
    expect(contentUrlFor(req('app.yayatoh.com'), custom, 'post', 'hello', opts)).toBe(
      'https://tickets.lakeside.example/blogs/hello',
    );
  });

  it('apex marketplace: the organizer page `/o/{slug}`, from the marketplace and the app host', () => {
    expect(contentUrlFor(req('yayatoh.com'), noSite, 'post', 'hello', opts)).toBe(
      'https://yayatoh.com/o/lakeside/blogs/hello',
    );
    expect(contentUrlFor(req('app.yayatoh.com'), noSite, 'page', 'about', opts)).toBe(
      'https://yayatoh.com/o/lakeside/pages/about',
    );
  });

  it('dev and preview hosts: `/organizers/{slug}` on this host, never the console `/o/{slug}`', () => {
    expect(contentUrlFor(req('localhost', 'http:', '3100'), noSite, 'post', 'hello', opts)).toBe(
      'http://localhost:3100/organizers/lakeside/blogs/hello',
    );
    expect(contentUrlFor(req('pr-12.vercel.app'), noSite, 'page', 'about', opts)).toBe(
      'https://pr-12.vercel.app/organizers/lakeside/pages/about',
    );
  });

  it('the marketplace content org lives at the apex root', () => {
    const o = { apexHost: 'yayatoh.com', isContentOrg: true };
    expect(contentHomeFor(req('app.yayatoh.com'), noSite, o)).toEqual({
      origin: 'https://yayatoh.com',
      base: '',
    });
    expect(contentHomeFor(req('localhost', 'http:', '3100'), noSite, o)).toEqual({
      origin: 'http://localhost:3100',
      base: '',
    });
  });

  it('a tenant site flag without a host falls back to the organizer page', () => {
    const half = { slug: 'lakeside', tenantSite: true, primaryHost: null };
    expect(contentHomeFor(req('yayatoh.com'), half, opts).base).toBe('/o/lakeside');
  });

  it('organizerBase: short form on the marketplace only', () => {
    expect(organizerBase('marketplace', 'x')).toBe('/o/x');
    expect(organizerBase('dev', 'x')).toBe('/organizers/x');
    expect(organizerBase('app', 'x')).toBe('/organizers/x');
  });
});
