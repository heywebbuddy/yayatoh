import { LOCALES } from '@yayatoh/contracts';
import { frameAncestors, matchLegacyRedirect, widgetOrigins } from '@yayatoh/marketplace';
import {
  DEVICE_COOKIE,
  generateNonce,
  isDeviceId,
  newDeviceId,
  pageTypeOf,
  securityHeaders,
  stripLocale,
} from '@yayatoh/platform/security';
import { resolveHost } from '@yayatoh/tenancy';
import { NextRequest, NextResponse } from 'next/server';
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
 * Every response gets request protection (M1.14a): a fresh CSP nonce (Next reads it from the
 * request's CSP header and stamps its own scripts), the security headers for its page type, and a
 * device cookie that the rate limiter keys on (so people sharing an IP don't share limits).
 */
const intl = createMiddleware(routing);
const FILE = /\/[^/]*\.[^/]+$/;
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

function notFound(req: NextRequest, forwarded: Headers, locale: string) {
  // No such page: render the app's 404 (the segment never exists).
  return NextResponse.rewrite(new URL(`/${locale}/_not-found-${Date.now().toString(36)}`, req.url), {
    request: { headers: forwarded },
  });
}

/** Rewrite to an internal path while keeping next-intl's cookies, Link header and locale. */
function rewrite(
  req: NextRequest,
  forwarded: Headers,
  from: NextResponse,
  internalPath: string,
  locale: string,
) {
  const url = new URL(internalPath + req.nextUrl.search, req.url);
  const headers = new Headers(forwarded);
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

export default async function proxy(req: NextRequest): Promise<NextResponse> {
  const host = bareHost(req.headers.get('host'));
  const kind = classifyHost(host);
  const path = req.nextUrl.pathname;
  const https = req.nextUrl.protocol === 'https:';
  const nonce = generateNonce();
  const headers = securityHeaders(pageTypeOf(stripLocale(path, routing.locales)), {
    nonce,
    dev: process.env.NODE_ENV === 'development',
    https,
  });
  const forwarded = new Headers(req.headers);
  forwarded.set('x-nonce', nonce);
  forwarded.set('content-security-policy', headers['content-security-policy'] as string);
  const secure = (res: NextResponse) => {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    if (!isDeviceId(req.cookies.get(DEVICE_COOKIE)?.value))
      res.cookies.set(DEVICE_COOKIE, newDeviceId(), {
        httpOnly: true,
        sameSite: 'lax',
        secure: https,
        path: '/',
        maxAge: 60 * 60 * 24 * 400,
      });
    return res;
  };

  // Files (and 404s for dotted paths such as /robots.txt) skip routing but still get the headers,
  // so even a not-found page renders under the CSP with this response's nonce.
  if (FILE.test(path)) return secure(NextResponse.next({ request: { headers: forwarded } }));

  const lang = /^\/lang\/([a-z]{2})\/?$/.exec(path);
  if (lang) return secure(languageSwitch(req, lang[1] ?? '', host));

  let orgId: string | null = null;
  if (kind === 'tenant') {
    let site = hosts.get(host);
    if (site === undefined) {
      site = await resolveHost(host);
      hosts.set(host, site);
    }
    if (!site)
      return secure(
        new NextResponse('Unknown site', { status: 404, headers: { 'content-type': 'text/plain' } }),
      );
    if (site.primaryHost && site.primaryHost !== host) {
      const to = onHost(req, req.nextUrl.pathname + req.nextUrl.search);
      to.hostname = site.primaryHost;
      return secure(NextResponse.redirect(to, 308));
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
      return secure(NextResponse.redirect(target, hit.status));
    }
  }

  const res = intl(new NextRequest(req, { headers: forwarded }));
  if (res.headers.has('location')) return secure(res);
  const rewritten = res.headers.get('x-middleware-rewrite');
  const internal = rewritten ? new URL(rewritten).pathname : path;
  const { locale, rest } = splitLocale(internal);

  // Internal segments are never addressable from outside.
  if (rest === '/t' || rest.startsWith('/t/')) return secure(notFound(req, forwarded, locale));

  if (orgId) {
    if (rest === '/') return secure(rewrite(req, forwarded, res, `/${locale}/t/${orgId}`, locale));
    const ev = /^\/events\/([^/]+)\/?$/.exec(rest);
    if (ev) return secure(rewrite(req, forwarded, res, `/${locale}/t/${orgId}/events/${ev[1]}`, locale));
  }

  // The ticket widget: only the org's allowed origins may frame it (M1.11c). Its CSP is the public
  // one with frame-ancestors widened to those origins (already normalized: https, or http on
  // localhost for testing); X-Frame-Options can't express a list, so it is left off.
  const embed = /^\/embed\/([^/]+)\/?$/.exec(rest);
  if (embed) {
    // Not cached: an organizer's origin change applies to the very next load.
    const origins = await widgetOrigins(embed[1] ?? '');
    secure(res);
    res.headers.set(
      'content-security-policy',
      (headers['content-security-policy'] as string).replace(
        /frame-ancestors [^;]*/,
        frameAncestors(origins ?? []),
      ),
    );
    res.headers.delete('x-frame-options');
    return res;
  }

  if (kind === 'marketplace') {
    const org = /^\/o\/([^/]+)\/?$/.exec(rest);
    if (org) return secure(rewrite(req, forwarded, res, `/${locale}/organizers/${org[1]}`, locale));
    const long = /^\/organizers\/([^/]+)\/?$/.exec(rest);
    if (long) return secure(NextResponse.redirect(onHost(req, localizedPath(locale, `/o/${long[1]}`)), 308));
  }
  return secure(res);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel).*)'],
};
