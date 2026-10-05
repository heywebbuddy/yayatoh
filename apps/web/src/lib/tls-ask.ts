import { appHosts, marketplaceHosts } from './hosts.ts';

/**
 * Caddy's on-demand TLS check (ADR 0024): a certificate is issued only for hosts this app serves:
 * the configured marketplace and app hosts, and tenant hosts that resolve to an org (its
 * `{slug}` subdomain or a verified custom domain). Anything else gets no certificate, so stray
 * DNS records pointing at the server cannot burn the ACME rate limits.
 */
export async function tlsAllowed(
  domain: string | null,
  resolve: (host: string) => Promise<unknown>,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const host = (domain ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) return false;
  if (marketplaceHosts(env).includes(host) || appHosts(env).includes(host)) return true;
  return (await resolve(host)) != null;
}
