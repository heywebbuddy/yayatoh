import { LOCALES } from '@yayatoh/contracts';
import { frameAncestors, matchLegacyRedirect, widgetOrigins } from '@yayatoh/marketplace';
import { resolveHost } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing.ts';
import { bareHost, classifyHost } from './lib/hosts.ts';
import { localizedPath } from './lib/seo/urls.ts';
import { TtlCache } from './lib/ttl-cache.ts';

/**
 * Optimistic only (CLAUDE.md): no authorization here. The proxy maps the Host to a site
 * (roadmap §3.3, §4.2): tenant hosts resolve through `org_domains` (non-primary hosts 308 to the
 * primary) and their public pages rewrite to `/[locale]/t/[org]/…`, so the org is a route param,
 * never a header. Legacy URLs (roadmap §7.7) 3xx from `legacy_redirects`. Then locale routing.
 */
const intl = createMiddleware(routing);
const hosts = new TtlCache<{ orgId: string; primaryHost: string | null } | null>(1000, 30_000);
const redirects = new TtlCache<{ location: string; status: number } | null>(5000, 60_000);
const LOCALE_SET = new Set<string>(LOCALES);

function splitLocale(path: string): { locale: string; rest: string } {
  const [, first = '', ...more] = path.split('/');
  if (LOCALE_SET.has(first)) return { locale: first, rest: `/${more.join('/')}` };
  return { locale: routing.defaultLocale, rest: path };
}

/** An absolute URL on the host the client asked for (req.url carries the server's own host). */
function onHost(req: NextRequest, pathAndQuery: string): URL {
  const host = req.headers.get('host') ?? req.nextUrl.host;
  return new URL(pathAndQuery, `${req.nextUrl.protocol}//${host}`);
}

function notFound(req: NextRequest, locale: string) {
  // No such page: render the app's 404 (the segment never exists).
  return NextResponse.rewrite(new URL(`/${locale}/_not-found-${Date.now().toString(36)}`, req.url));
}

/** Rewrite to an internal path while keeping next-intl's cookies, Link header and locale. */
function rewrite(req: NextRequest, from: NextResponse, internalPath: string, locale: string) {
  const url = new URL(internalPath + req.nextUrl.search, req.url);
  const headers = new Headers(req.headers);
  headers.set('X-NEXT-INTL-LOCALE', locale);
  const res = NextResponse.rewrite(url, { request: { headers } });
  for (const name of ['set-cookie', 'link']) {
    const v = from.headers.get(name);
    if (v) res.headers.set(name, v);
  }
  return res;
}

/** `/lang/{code}` sets the language and goes back (roadmap §7.7: this 500s on the legacy site). */
function languageSwitch(req: NextRequest, code: string, host: string) {
  const locale = LOCALE_SET.has(code) ? code : routing.defaultLocale;
  let back = '/';
  const ref = req.headers.get('referer');
  if (ref) {
    try {
      const u = new URL(ref);
      if (bareHost(u.host) === host) back = splitLocale(u.pathname).rest + u.search;
    } catch {
      // A malformed referer goes home.
    }
  }
  const res = NextResponse.redirect(onHost(req, localizedPath(locale, back)), 302);
  res.cookies.set('NEXT_LOCALE', locale, { path: '/', sameSite: 'lax' });
  return res;
}

export default async function proxy(req: NextRequest) {
  const host = bareHost(req.headers.get('host'));
  const kind = classifyHost(host);
  const path = req.nextUrl.pathname;

  const lang = /^\/lang\/([a-z]{2})\/?$/.exec(path);
  if (lang) return languageSwitch(req, lang[1] ?? '', host);

  let orgId: string | null = null;
  if (kind === 'tenant') {
    let site = hosts.get(host);
    if (site === undefined) {
      site = await resolveHost(host);
      hosts.set(host, site);
    }
    if (!site)
      return new NextResponse('Unknown site', { status: 404, headers: { 'content-type': 'text/plain' } });
    if (site.primaryHost && site.primaryHost !== host) {
      const to = onHost(req, req.nextUrl.pathname + req.nextUrl.search);
      to.hostname = site.primaryHost;
      return NextResponse.redirect(to, 308);
    }
    orgId = site.orgId;
  }

  if (kind !== 'app' && (req.method === 'GET' || req.method === 'HEAD')) {
    const key = `${host}|${path}`;
    let hit = redirects.get(key);
    if (hit === undefined) {
      hit = await matchLegacyRedirect(host, path);
      redirects.set(key, hit);
    }
    if (hit) {
      const target = onHost(req, hit.location);
      for (const [k, v] of req.nextUrl.searchParams)
        if (!target.searchParams.has(k)) target.searchParams.set(k, v);
      return NextResponse.redirect(target, hit.status);
    }
  }

  const res = intl(req);
  if (res.headers.has('location')) return res;
  const rewritten = res.headers.get('x-middleware-rewrite');
  const internal = rewritten ? new URL(rewritten).pathname : path;
  const { locale, rest } = splitLocale(internal);

  // Internal segments are never addressable from outside.
  if (rest === '/t' || rest.startsWith('/t/')) return notFound(req, locale);

  if (orgId) {
    if (rest === '/') return rewrite(req, res, `/${locale}/t/${orgId}`, locale);
    const ev = /^\/events\/([^/]+)\/?$/.exec(rest);
    if (ev) return rewrite(req, res, `/${locale}/t/${orgId}/events/${ev[1]}`, locale);
  }

  // The ticket widget: only the org's allowed origins may frame it (M1.11c).
  const embed = /^\/embed\/([^/]+)\/?$/.exec(rest);
  if (embed) {
    // Not cached: an organizer's origin change applies to the very next load.
    const origins = await widgetOrigins(embed[1] ?? '');
    res.headers.set('Content-Security-Policy', frameAncestors(origins ?? []));
    return res;
  }

  if (kind === 'marketplace') {
    const org = /^\/o\/([^/]+)\/?$/.exec(rest);
    if (org) return rewrite(req, res, `/${locale}/organizers/${org[1]}`, locale);
    const long = /^\/organizers\/([^/]+)\/?$/.exec(rest);
    if (long) return NextResponse.redirect(onHost(req, localizedPath(locale, `/o/${long[1]}`)), 308);
  }
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
