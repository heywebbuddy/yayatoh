import { type NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@/server/auth.ts';
import { personaByEmail } from '@/server/personas.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/preview persona sign-in: a real Better Auth password sign-in with the seed password.
 * 404 unless explicitly enabled; never available in production.
 */
export async function POST(req: NextRequest) {
  const password = process.env.DEV_PERSONA_PASSWORD;
  if (!devAuthEnabled() || !password) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const persona = personaByEmail(String(form.get('email') ?? ''));
  const locale = String(form.get('locale') ?? 'en');
  if (!persona) return new NextResponse(null, { status: 400 });
  const signIn = await getAuth().api.signInEmail({
    body: { email: persona.email, password },
    headers: req.headers,
    asResponse: true,
  });
  if (!signIn.ok) return new NextResponse(null, { status: 401 });
  const prefix = locale === 'en' ? '' : `/${encodeURIComponent(locale)}`;
  const res = NextResponse.redirect(new URL(`${prefix}/o/${persona.orgSlug}`, req.url), 303);
  for (const c of signIn.headers.getSetCookie()) res.headers.append('set-cookie', c);
  return res;
}
