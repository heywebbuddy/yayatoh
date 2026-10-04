import { type NextRequest, NextResponse } from 'next/server';
import { requestHost } from '@/server/request-origin.ts';
import { ssoStateCookie } from '@/server/sso.ts';
import { finishSsoRequest } from '@/server/sso-finish.ts';

export const dynamic = 'force-dynamic';

/**
 * SAML 2.0 Assertion Consumer Service (HTTP-POST binding, M6.5a): the IdP's form posts
 * `SAMLResponse` and `RelayState` (our state). IdP-initiated sign-in (no RelayState we issued)
 * is refused: every answer must belong to a request this browser started.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const here = await requestHost();
  if (here.kind === 'tenant') return new NextResponse('Not found', { status: 404 });
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > 200_000) return new NextResponse('Too large', { status: 413 });
  const form = await req.formData().catch(() => null);
  const field = (k: string) => {
    const v = form?.get(k);
    return typeof v === 'string' ? v : null;
  };
  return finishSsoRequest(
    locale,
    {
      state: field('RelayState'),
      response: (field('SAMLResponse') ?? '').slice(0, 100_000),
      error: field('error'),
      cookie: req.cookies.get(ssoStateCookie(here.protocol === 'https:'))?.value,
    },
    req.headers,
  );
}
