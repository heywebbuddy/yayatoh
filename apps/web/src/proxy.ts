import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing.ts';

// Optimistic only (CLAUDE.md): locale routing here; authorization happens in commands.
export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
