import 'server-only';
import { portalCtx } from '@yayatoh/events';
import type { Ctx } from '@yayatoh/kernel';
import { problem, problemResponse } from '@yayatoh/platform/http';
import { routing } from '@/i18n/routing.ts';
import { currentPortalPrincipal } from './portal.ts';

/**
 * The Scan PWA's lead mode (M5.6b) talks to `/api/scan/leads` with the portal session cookie
 * (M5.3a: host-only, httpOnly, SameSite=Lax). Writes must be JSON (a cross-site form can't send
 * it without a CORS preflight, which these routes never answer). The org and the person come
 * from the cookie; the commands re-check the account and act on its own exhibitor.
 */
export async function leadCaller(req: Request, write = false): Promise<Ctx | Response> {
  if (write && !(req.headers.get('content-type') ?? '').startsWith('application/json'))
    return problemResponse(problem('validation_failed', 'JSON required'));
  const principal = await currentPortalPrincipal();
  if (principal?.subjectKind !== 'exhibitor')
    return problemResponse(problem('unauthenticated', 'Sign in with your exhibitor invitation'));
  const asked = req.headers.get('x-yy-locale') ?? 'en';
  const locale = (routing.locales as readonly string[]).includes(asked) ? asked : 'en';
  return portalCtx(principal, locale);
}

export const noStore = { 'cache-control': 'no-store' };
