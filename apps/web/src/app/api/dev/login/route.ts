import { type NextRequest, NextResponse } from 'next/server';
import { devPasswordSignIn } from '@/server/dev-sign-in.ts';
import { personaByEmail } from '@/server/personas.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/preview persona sign-in: a real Better Auth password sign-in with the seed password. Personas
 * with two-step verification (the seeded owners) pass the real challenge with their dev-only TOTP
 * secret, derived from the persona password (never in the repo). 404 unless explicitly enabled;
 * never available in production.
 */
export async function POST(req: NextRequest) {
  const password = process.env.DEV_PERSONA_PASSWORD;
  if (!devAuthEnabled() || !password) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const persona = personaByEmail(String(form.get('email') ?? ''));
  const locale = String(form.get('locale') ?? 'en');
  if (!persona) return new NextResponse(null, { status: 400 });
  const cookies = await devPasswordSignIn(persona.email, password, null, req.headers);
  if (!cookies) return new NextResponse(null, { status: 401 });
  const prefix = locale === 'en' ? '' : `/${encodeURIComponent(locale)}`;
  const res = NextResponse.redirect(new URL(`${prefix}/o/${persona.orgSlug}`, req.url), 303);
  for (const c of cookies) res.headers.append('set-cookie', c);
  return res;
}
