import 'server-only';
import { resolveHost } from '@yayatoh/tenancy';
import { parseTenantReturn, type TenantReturn } from '@/lib/hosts.ts';

export const appOrigin = () => process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

/**
 * A tenant site's "come back here" URL (M1.2d): a tenant host of our own scheme and port that is
 * one of an org's verified hosts, and its canonical one (a non-primary host would redirect and
 * lose the session). Anything else is ignored: the sign-in then just opens the console.
 */
export async function verifiedTenantReturn(raw: string | null | undefined): Promise<TenantReturn | null> {
  const ret = parseTenantReturn(raw, appOrigin());
  if (!ret) return null;
  const site = await resolveHost(ret.hostname);
  if (!site || (site.primaryHost && site.primaryHost !== ret.hostname)) return null;
  return ret;
}
