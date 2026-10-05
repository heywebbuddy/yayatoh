import { describe, expect, it } from 'vitest';
import { type DnsLookup, domainProviderFromEnv, selfHostedDomainProvider } from '../src/index.ts';

const SECRET = 's'.repeat(64);
const TARGET = 'sites.yayatoh.com';

/** DNS from a table: name → records per type. */
function dnsTable(t: Record<string, { txt?: string[]; cname?: string[]; a?: string[] }>): DnsLookup {
  return {
    txt: async (n) => t[n]?.txt ?? [],
    cname: async (n) => t[n]?.cname ?? [],
    a: async (n) => t[n]?.a ?? [],
  };
}

describe('self-hosted domain provider', () => {
  const server = { [TARGET]: { a: ['203.0.113.10'] } };

  it('asks for a CNAME to the platform and a TXT ownership record', async () => {
    const p = selfHostedDomainProvider({ secret: SECRET, target: TARGET, lookup: dnsTable(server) });
    const added = await p.addDomain('tickets.example.org');
    expect(added.status).toBe('pending_dns');
    expect(added.records[0]).toEqual({ type: 'CNAME', name: 'tickets.example.org', value: TARGET });
    expect(added.records[1]?.name).toBe('_yayatoh.tickets.example.org');
    expect(added.records[1]?.value).toMatch(/^yayatoh-verify=[0-9a-f]{24}$/);
    expect(added.providerRef).toMatch(/^self_/);
  });

  it('goes active once ownership and routing are both published (CNAME or A records)', async () => {
    const probe = selfHostedDomainProvider({ secret: SECRET, target: TARGET, lookup: dnsTable(server) });
    const txt = (h: string) => async () => (await probe.addDomain(h)).records[1]?.value as string;
    const viaCname = selfHostedDomainProvider({
      secret: SECRET,
      target: TARGET,
      lookup: dnsTable({
        ...server,
        '_yayatoh.tickets.example.org': { txt: [await txt('tickets.example.org')()] },
        'tickets.example.org': { cname: ['Sites.Yayatoh.com.'] },
      }),
    });
    expect(await viaCname.checkDomain('tickets.example.org')).toMatchObject({
      status: 'active',
      sslStatus: 'issued',
    });
    const apex = selfHostedDomainProvider({
      secret: SECRET,
      target: TARGET,
      lookup: dnsTable({
        ...server,
        '_yayatoh.example.org': { txt: [await txt('example.org')()] },
        'example.org': { a: ['203.0.113.10'] },
      }),
    });
    expect((await apex.checkDomain('example.org')).status).toBe('active');
  });

  it('waits for routing, and reports a conflict when the host points elsewhere', async () => {
    const probe = selfHostedDomainProvider({ secret: SECRET, target: TARGET, lookup: dnsTable(server) });
    const token = (await probe.addDomain('tickets.example.org')).records[1]?.value as string;
    const owned = { '_yayatoh.tickets.example.org': { txt: [token] } };
    const waiting = selfHostedDomainProvider({
      secret: SECRET,
      target: TARGET,
      lookup: dnsTable({ ...server, ...owned }),
    });
    expect((await waiting.checkDomain('tickets.example.org')).status).toBe('verifying');
    const elsewhere = selfHostedDomainProvider({
      secret: SECRET,
      target: TARGET,
      lookup: dnsTable({ ...server, ...owned, 'tickets.example.org': { a: ['198.51.100.7'] } }),
    });
    expect(await elsewhere.checkDomain('tickets.example.org')).toMatchObject({
      status: 'failed',
      reason: 'dns_conflict',
    });
  });

  it('never accepts another domain’s token', async () => {
    const probe = selfHostedDomainProvider({ secret: SECRET, target: TARGET, lookup: dnsTable(server) });
    const other = (await probe.addDomain('other.example.org')).records[1]?.value as string;
    const p = selfHostedDomainProvider({
      secret: SECRET,
      target: TARGET,
      lookup: dnsTable({
        ...server,
        '_yayatoh.tickets.example.org': { txt: [other] },
        'tickets.example.org': { cname: [TARGET] },
      }),
    });
    expect((await p.checkDomain('tickets.example.org')).status).toBe('pending_dns');
  });
});

describe('domainProviderFromEnv', () => {
  it('builds the self-hosted provider, the dev fake, or nothing', () => {
    expect(
      domainProviderFromEnv({
        DOMAIN_PROVIDER: 'self_hosted',
        DOMAIN_CNAME_TARGET: TARGET,
        APP_TOKEN_SECRET: SECRET,
      })?.name,
    ).toBe('self_hosted');
    expect(() => domainProviderFromEnv({ DOMAIN_PROVIDER: 'self_hosted' })).toThrow(/DOMAIN_CNAME_TARGET/);
    expect(() => domainProviderFromEnv({ DOMAIN_PROVIDER: 'vercel' })).toThrow(/Unknown DOMAIN_PROVIDER/);
    expect(domainProviderFromEnv({ FAKE_PAYMENTS_SECRET: SECRET })?.name).toBe('fake');
    expect(domainProviderFromEnv({})).toBeNull();
  });
});
