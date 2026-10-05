import { createHmac } from 'node:crypto';

export interface DnsRecord {
  readonly type: 'A' | 'CNAME' | 'TXT';
  readonly name: string;
  readonly value: string;
}

/** What the hosting provider says about a hostname right now. */
export interface DomainCheck {
  readonly status: 'pending_dns' | 'verifying' | 'active' | 'failed';
  readonly records: readonly DnsRecord[];
  readonly sslStatus: 'pending' | 'issued' | null;
  readonly reason: string | null;
}

/**
 * Hosting domains (Vercel Domains API, M1.3d). Calls are idempotent per hostname and happen
 * outside transactions; commands record what they return. Vercel's add limit (100/h) is the
 * adapter's concern.
 */
export interface DomainProvider {
  readonly name: 'fake' | 'vercel';
  addDomain(hostname: string): Promise<{ providerRef: string } & DomainCheck>;
  checkDomain(hostname: string): Promise<DomainCheck>;
  removeDomain(hostname: string): Promise<void>;
}

/**
 * Fake hosting provider (dev, preview, CI) until the owner's Vercel account exists. DNS is
 * simulated from the name: `*.verified.test` has its records published (active, certificate
 * issued), `*.fail.test` points elsewhere (failed), anything else waits for DNS.
 */
export function fakeDomainProvider(opts: { secret: string }): DomainProvider {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The fake domain provider is not allowed in production');
  const token = (host: string) =>
    createHmac('sha256', opts.secret).update(`domain:${host}`).digest('hex').slice(0, 16);
  const records = (host: string): DnsRecord[] => [
    { type: 'CNAME', name: host, value: 'cname.fake-dns.test' },
    { type: 'TXT', name: `_vercel.${host}`, value: `vc-domain-verify=${host},${token(host)}` },
  ];
  const check = (host: string): DomainCheck =>
    host.endsWith('.verified.test')
      ? { status: 'active', records: records(host), sslStatus: 'issued', reason: null }
      : host.endsWith('.fail.test')
        ? { status: 'failed', records: records(host), sslStatus: null, reason: 'dns_conflict' }
        : { status: 'pending_dns', records: records(host), sslStatus: null, reason: null };
  return {
    name: 'fake',
    async addDomain(host) {
      return {
        providerRef: `fakedom_${token(host)}`,
        status: 'pending_dns',
        records: records(host),
        sslStatus: null,
        reason: null,
      };
    },
    async checkDomain(host) {
      return check(host);
    },
    async removeDomain() {},
  };
}
