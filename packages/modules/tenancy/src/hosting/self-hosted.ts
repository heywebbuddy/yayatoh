import { createHmac } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { type DnsRecord, type DomainCheck, type DomainProvider, fakeDomainProvider } from './provider.ts';

/** The DNS lookups the self-hosted provider needs (node:dns by default; tests pass a table). */
export interface DnsLookup {
  txt(name: string): Promise<string[]>;
  cname(name: string): Promise<string[]>;
  a(name: string): Promise<string[]>;
}

const swallow = async (p: Promise<string[]>) => p.catch(() => [] as string[]);

export const systemDns: DnsLookup = {
  txt: (n) => swallow(dns.resolveTxt(n).then((rows) => rows.map((r) => r.join('')))),
  cname: (n) => swallow(dns.resolveCname(n)),
  a: (n) => swallow(dns.resolve4(n)),
};

/**
 * Custom domains on our own server (ADR 0024). The organizer publishes a TXT record proving the
 * domain is theirs and points the host at the platform (a CNAME to `target`, or A records to the
 * server for an apex domain). Once both are seen the domain is active, and Caddy issues its
 * certificate on the first HTTPS request (the on-demand TLS check asks `tenancy.org_by_host`).
 * Removing a domain needs nothing here: the TLS check stops allowing it.
 */
export function selfHostedDomainProvider(opts: {
  secret: string;
  /** The hostname tenant domains CNAME to, e.g. `sites.yayatoh.com` (its A records are the server). */
  target: string;
  lookup?: DnsLookup;
}): DomainProvider {
  if (opts.secret.length < 32) throw new Error('domain verification secret must be ≥32 chars');
  const lookup = opts.lookup ?? systemDns;
  const target = opts.target.toLowerCase().replace(/\.$/, '');
  const token = (host: string) =>
    createHmac('sha256', opts.secret).update(`domain:${host}`).digest('hex').slice(0, 24);
  const records = (host: string): DnsRecord[] => [
    { type: 'CNAME', name: host, value: target },
    { type: 'TXT', name: `_yayatoh.${host}`, value: `yayatoh-verify=${token(host)}` },
  ];
  const norm = (s: string) => s.toLowerCase().replace(/\.$/, '');

  async function check(host: string): Promise<DomainCheck> {
    const recs = records(host);
    const [txt, cname, hostA, targetA] = await Promise.all([
      lookup.txt(`_yayatoh.${host}`),
      lookup.cname(host),
      lookup.a(host),
      lookup.a(target),
    ]);
    const owned = txt.some((t) => t.trim() === `yayatoh-verify=${token(host)}`);
    const routed =
      cname.map(norm).includes(target) || (hostA.length > 0 && hostA.every((ip) => targetA.includes(ip)));
    if (owned && routed) return { status: 'active', records: recs, sslStatus: 'issued', reason: null };
    if (owned && (cname.length > 0 || hostA.length > 0))
      return { status: 'failed', records: recs, sslStatus: null, reason: 'dns_conflict' };
    if (owned) return { status: 'verifying', records: recs, sslStatus: null, reason: null };
    return { status: 'pending_dns', records: recs, sslStatus: null, reason: null };
  }

  return {
    name: 'self_hosted',
    async addDomain(host) {
      return { providerRef: `self_${token(host)}`, ...(await check(host)) };
    },
    checkDomain: check,
    async removeDomain() {},
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The domain provider from configuration: `DOMAIN_PROVIDER=self_hosted` with `DOMAIN_CNAME_TARGET`
 * (verification tokens from `APP_TOKEN_SECRET`), else the fake provider when `FAKE_PAYMENTS_SECRET`
 * is set (dev, preview, CI; refused in production), else null.
 */
export function domainProviderFromEnv(env: Env = process.env): DomainProvider | null {
  if (env.DOMAIN_PROVIDER === 'self_hosted') {
    if (!env.DOMAIN_CNAME_TARGET || !env.APP_TOKEN_SECRET)
      throw new Error('DOMAIN_PROVIDER=self_hosted needs DOMAIN_CNAME_TARGET and APP_TOKEN_SECRET');
    return selfHostedDomainProvider({ secret: env.APP_TOKEN_SECRET, target: env.DOMAIN_CNAME_TARGET });
  }
  if (env.DOMAIN_PROVIDER && env.DOMAIN_PROVIDER !== 'fake')
    throw new Error(`Unknown DOMAIN_PROVIDER: ${env.DOMAIN_PROVIDER}`);
  return env.FAKE_PAYMENTS_SECRET ? fakeDomainProvider({ secret: env.FAKE_PAYMENTS_SECRET }) : null;
}
