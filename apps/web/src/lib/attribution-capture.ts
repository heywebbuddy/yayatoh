import {
  CLICK_COOKIE,
  CLICK_COOKIE_MAX_AGE_S,
  CLICK_PARAM,
  DAY_MS,
  decodeUtmCookie,
  encodeUtmCookie,
  MAX_WINDOW_DAYS,
  nextUtmCookie,
  UTM_COOKIE,
  utmFromParams,
  verifyClickToken,
} from '@yayatoh/marketing/click';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * Landing capture (M3.8a), run by the proxy on page requests. A valid signed click id in the URL
 * (`yyc`, e.g. a shared tracked-link landing) becomes the `yy_click` cookie; a forged, altered or
 * expired one is ignored. Without one, `utm_*` values become the `yy_utm` cookie (first and last
 * landing) for UTM-only attribution. Optimistic only: checkout verifies everything again.
 */
export function captureLanding(req: NextRequest, res: NextResponse, opts: { https: boolean }): void {
  if (req.method !== 'GET') return;
  const params = req.nextUrl.searchParams;
  const secret = process.env.APP_TOKEN_SECRET;
  const cookie = { httpOnly: true, sameSite: 'lax' as const, secure: opts.https, path: '/' };
  const token = params.get(CLICK_PARAM);
  if (token) {
    if (!secret || secret.length < 32) return;
    const now = Date.now();
    const valid = verifyClickToken(token, secret, { now, maxAgeMs: CLICK_COOKIE_MAX_AGE_S * 1000 });
    if (valid && req.cookies.get(CLICK_COOKIE)?.value !== token)
      res.cookies.set(CLICK_COOKIE, token, { ...cookie, maxAge: CLICK_COOKIE_MAX_AGE_S });
    return;
  }
  const utm = utmFromParams(params);
  if (!utm) return;
  const windowMs = MAX_WINDOW_DAYS * DAY_MS;
  const next = nextUtmCookie(decodeUtmCookie(req.cookies.get(UTM_COOKIE)?.value), utm, Date.now(), windowMs);
  res.cookies.set(UTM_COOKIE, encodeUtmCookie(next), { ...cookie, maxAge: windowMs / 1000 });
}
