import { createHmac } from 'node:crypto';

/** The fake IdP's signing seed (M6.5a): derived from BETTER_AUTH_SECRET; never in production. */
export function fakeIdpSeed(): string | null {
  if (process.env.VERCEL_ENV === 'production') return null;
  const secret = process.env.BETTER_AUTH_SECRET;
  return secret ? createHmac('sha256', secret).update('yayatoh:fake-idp').digest('hex') : null;
}
