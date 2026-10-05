import 'server-only';
import { type DomainProvider, domainProviderFromEnv } from '@yayatoh/tenancy';

let provider: DomainProvider | undefined;

/**
 * The hosting domain provider: `DOMAIN_PROVIDER=self_hosted` on our own server (DNS checks; Caddy
 * issues the certificates, ADR 0024); dev, preview and CI use the fake provider, which refuses to
 * run in production.
 */
export function getDomainProvider(): DomainProvider {
  if (!provider) {
    const p = domainProviderFromEnv();
    if (!p)
      throw new Error('No domain provider configured (DOMAIN_PROVIDER, or FAKE_PAYMENTS_SECRET for dev)');
    provider = p;
  }
  return provider;
}
