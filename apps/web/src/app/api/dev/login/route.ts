import { type NextRequest, NextResponse } from 'next/server';
import { personaById } from '@/server/personas.ts';
import { DEV_SESSION_COOKIE, devAuthEnabled } from '@/server/session.ts';

/** Dev/preview persona sign-in (replaced by Better Auth in M1.2). 404 unless explicitly enabled. */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const persona = personaById(String(form.get('userId') ?? ''));
  const locale = String(form.get('locale') ?? 'en');
  if (!persona) return new NextResponse(null, { status: 400 });
  const prefix = locale === 'en' ? '' : `/${encodeURIComponent(locale)}`;
  const res = NextResponse.redirect(new URL(`${prefix}/o/${persona.orgSlug}`, req.url), 303);
  res.cookies.set(DEV_SESSION_COOKIE, persona.userId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return res;
}
