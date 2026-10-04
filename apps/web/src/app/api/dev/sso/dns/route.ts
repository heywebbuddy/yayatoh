import { publishFakeTxt, ssoRuntime } from '@yayatoh/sso';
import { type NextRequest, NextResponse } from 'next/server';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M6.5a): publish (or with `value` empty, remove) a TXT record in the fake DNS, as the
 * org's DNS admin would at their registrar. 404 unless dev auth is on and SSO runs on the fakes.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled() || ssoRuntime().idp?.kind !== 'fake') return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const name = String(form.get('name') ?? '').trim();
  const value = String(form.get('value') ?? '').trim();
  if (!/^_yayatoh-sso\.[a-z0-9.-]{3,253}$/i.test(name) || value.length > 300)
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  publishFakeTxt(name, value || null);
  return new NextResponse(null, { status: 204 });
}
