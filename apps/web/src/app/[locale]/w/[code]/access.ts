import 'server-only';
import { cookies } from 'next/headers';

/**
 * A visitor's proof of a guest website's password (M4.5a): one httpOnly cookie per site, holding
 * the access token the site's query checks (bound to the site and its password version, so a new
 * password locks every earlier visitor out). Never readable by scripts, never sent elsewhere.
 */
const cookieName = (code: string) => `yy_site_${code}`;

export async function siteAccess(code: string): Promise<string | null> {
  return (await cookies()).get(cookieName(code))?.value ?? null;
}

export async function rememberSiteAccess(code: string, access: string): Promise<void> {
  (await cookies()).set(cookieName(code), access, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 60,
  });
}
