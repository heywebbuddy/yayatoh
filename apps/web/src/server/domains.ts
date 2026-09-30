import 'server-only';
import { type DomainProvider, fakeDomainProvider } from '@yayatoh/tenancy';

let provider: DomainProvider | undefined;

/**
 * The hosting domain provider. Vercel's Domains API arrives with the owner's Vercel account;
 * until then dev, preview and CI use the fake provider, which refuses to run in production.
 */
export function getDomainProvider(): DomainProvider {
  if (!provider) {
    const secret = process.env.FAKE_PAYMENTS_SECRET;
    if (!secret) throw new Error('No domain provider configured (FAKE_PAYMENTS_SECRET for dev/preview)');
    provider = fakeDomainProvider({ secret });
  }
  return provider;
}
