import type { NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing.ts';

const intl = createMiddleware(routing);

/** The public seat finder's pages (and the legacy `/events/{slug}/attendee` poster URL). */
const SEAT_FINDER = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?events\/[^/]+\/(?:seat-finder|attendee)(?:\/|$)/;
const DEVICE_COOKIE = 'yy_device';

// Optimistic only (CLAUDE.md): locale routing here; authorization happens in commands. The seat
// finder's pages also get an anonymous device cookie, which keys its rate limit (roadmap §6.1).
export default function proxy(req: NextRequest) {
  const res = intl(req);
  if (SEAT_FINDER.test(req.nextUrl.pathname) && !req.cookies.has(DEVICE_COOKIE))
    res.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 365 * 24 * 3600,
    });
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
