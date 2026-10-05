import { createHmac } from 'node:crypto';
import { isProductionEnv } from '@yayatoh/kernel';

/** The fake IdP's signing seed (M6.5a): derived from BETTER_AUTH_SECRET; never in production. */
export function fakeIdpSeed(): string | null {
  if (isProductionEnv()) return null;
  const secret = process.env.BETTER_AUTH_SECRET;
  return secret ? createHmac('sha256', secret).update('yayatoh:fake-idp').digest('hex') : null;
}
