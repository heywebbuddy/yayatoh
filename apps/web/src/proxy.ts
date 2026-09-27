import {
  DEVICE_COOKIE,
  generateNonce,
  isDeviceId,
  newDeviceId,
  pageTypeOf,
  securityHeaders,
  stripLocale,
} from '@yayatoh/platform/security';
import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing.ts';

const intl = createMiddleware(routing);
const FILE = /\/[^/]*\.[^/]+$/;

/**
 * Optimistic only (CLAUDE.md): locale routing and request protection; authorization happens in
 * commands. Every page gets a fresh CSP nonce (Next reads it from the request's CSP header and
 * stamps its own scripts), the security headers for its page type (M1.14a), and a device cookie
 * that the rate limiter keys on (so people sharing an IP don't share limits).
 */
export default function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const type = pageTypeOf(stripLocale(request.nextUrl.pathname, routing.locales));
  const https = request.nextUrl.protocol === 'https:';
  const headers = securityHeaders(type, {
    nonce,
    dev: process.env.NODE_ENV === 'development',
    https,
  });
  const forwarded = new Headers(request.headers);
  forwarded.set('x-nonce', nonce);
  forwarded.set('content-security-policy', headers['content-security-policy'] as string);
  // Files (and 404s for dotted paths such as /robots.txt) skip locale routing but still get the
  // headers, so even a not-found page renders under the CSP with this response's nonce.
  const response = FILE.test(request.nextUrl.pathname)
    ? NextResponse.next({ request: { headers: forwarded } })
    : intl(new NextRequest(request, { headers: forwarded }));
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  if (!isDeviceId(request.cookies.get(DEVICE_COOKIE)?.value)) {
    response.cookies.set(DEVICE_COOKIE, newDeviceId(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: https,
      path: '/',
      maxAge: 60 * 60 * 24 * 400,
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel).*)'],
};
