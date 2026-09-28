import { generateNonce, securityHeaders } from '@yayatoh/platform/security';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Request protection for the staff console (M1.3f, the M1.14a builder): every page gets the
 * strict CSP with a fresh nonce (Next reads it from the request's CSP header and stamps its own
 * scripts and styles), `style-src-attr 'none'`, `frame-ancestors 'none'`, and the console's other
 * security headers. Optimistic only: authorization happens in the pages and actions.
 */
export default function proxy(req: NextRequest): NextResponse {
  // Evidence packets are documents, not pages: their route sends its own locked-down policy.
  if (/^\/tenants\/[^/]+\/disputes\/[^/]+\/evidence$/.test(req.nextUrl.pathname)) return NextResponse.next();
  const nonce = generateNonce();
  const headers = securityHeaders('console', {
    nonce,
    dev: process.env.NODE_ENV === 'development',
    https: req.nextUrl.protocol === 'https:',
  });
  const forwarded = new Headers(req.headers);
  forwarded.set('x-nonce', nonce);
  forwarded.set('content-security-policy', headers['content-security-policy'] as string);
  const res = NextResponse.next({ request: { headers: forwarded } });
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel).*)'],
};
