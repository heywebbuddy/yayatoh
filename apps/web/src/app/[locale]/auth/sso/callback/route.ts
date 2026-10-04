import { type NextRequest, NextResponse } from 'next/server';
import { requestHost } from '@/server/request-origin.ts';
import { ssoStateCookie } from '@/server/sso.ts';
import { finishSsoRequest } from '@/server/sso-finish.ts';

export const dynamic = 'force-dynamic';

/** OpenID Connect: the IdP sends the browser back with `code` and `state` (M6.5a). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const here = await requestHost();
  const q = req.nextUrl.searchParams;
  if (here.kind === 'tenant') return new NextResponse('Not found', { status: 404 });
  return finishSsoRequest(
    locale,
    {
      state: q.get('state'),
      response: (q.get('code') ?? '').slice(0, 16_384),
      error: q.get('error'),
      cookie: req.cookies.get(ssoStateCookie(here.protocol === 'https:'))?.value,
    },
    req.headers,
  );
}
