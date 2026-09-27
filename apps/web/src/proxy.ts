import {
  DEVICE_COOKIE,
  generateNonce,
  isDeviceId,
  newDeviceId,
  pageTypeOf,
  securityHeaders,
  stripLocale,
} from '@yayatoh/platform/security';
import { NextRequest, type NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing.ts';

const intl = createMiddleware(routing);

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
  const response = intl(new NextRequest(request, { headers: forwarded }));
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
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
