import 'server-only';
import { devPersonaTotpSecret, secretKey, totp } from '@yayatoh/auth/totp';
import { getAuth } from './auth.ts';

const cookiePairs = (setCookies: readonly string[]) =>
  setCookies
    .map((c) => c.split(';')[0] ?? '')
    .filter((p) => p.includes('=') && !p.endsWith('='))
    .join('; ');

/**
 * Development only (callers check `devAuthEnabled()`): a real password sign-in, and for people
 * with two-step verification the real challenge answered with their dev TOTP secret. Returns the
 * Set-Cookie headers to forward, or null when the sign-in fails.
 */
export async function devPasswordSignIn(
  email: string,
  password: string,
  totpSecret: string | null,
  headers: Headers,
): Promise<string[] | null> {
  const auth = getAuth();
  const res = await auth.api.signInEmail({ body: { email, password }, headers, asResponse: true });
  if (!res.ok) return null;
  const cookies = res.headers.getSetCookie();
  const body = (await res.json()) as { twoFactorRedirect?: boolean };
  if (!body.twoFactorRedirect) return cookies;
  const secret = totpSecret ?? devPersonaTotpSecret(email, password);
  const verified = await auth.api.verifyTOTP({
    body: { code: totp(secretKey(secret), Date.now()) },
    headers: new Headers({ cookie: cookiePairs(cookies) }),
    asResponse: true,
  });
  return verified.ok ? [...cookies, ...verified.headers.getSetCookie()] : null;
}
