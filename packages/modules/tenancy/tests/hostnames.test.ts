import { describe, expect, it } from 'vitest';
import { fakeDomainProvider, managedHostname, normalizeHostname, reservedHostname } from '../src/index.ts';

describe('hostnames', () => {
  it('normalizes what organizers type', () => {
    expect(normalizeHostname('https://Tickets.Example.com/')).toBe('tickets.example.com');
    expect(normalizeHostname(' tickets.example.com. ')).toBe('tickets.example.com');
    expect(normalizeHostname('bücher.example')).toBe('xn--bcher-kva.example');
  });

  it('refuses things that are not a domain name', () => {
    for (const bad of [
      '',
      'localhost',
      'example',
      '192.168.0.1',
      'tickets.example.com:8080',
      'tickets.example.com/path',
      'user@example.com',
      '-bad.example.com',
      'a..b.com',
      `${'a'.repeat(64)}.com`,
    ])
      expect(normalizeHostname(bad), bad).toBeNull();
  });

  it('reserves platform hosts', () => {
    expect(reservedHostname('abc.yayatoh.com')).toBe(true);
    expect(reservedHostname('yayatoh.com')).toBe(true);
    expect(reservedHostname(managedHostname('acme'))).toBe(true);
    expect(reservedHostname('x.vercel.app')).toBe(true);
    expect(reservedHostname('notyayatoh.com')).toBe(false);
    expect(reservedHostname('tickets.example.com')).toBe(false);
  });
});

describe('fake domain provider', () => {
  const p = fakeDomainProvider({ secret: 's'.repeat(40) });
  it('asks for DNS records and simulates DNS from the name', async () => {
    const added = await p.addDomain('a.verified.test');
    expect(added.status).toBe('pending_dns');
    expect(added.records.map((r) => r.type)).toEqual(['CNAME', 'TXT']);
    expect((await p.checkDomain('a.verified.test')).status).toBe('active');
    expect((await p.checkDomain('a.fail.test')).status).toBe('failed');
    expect((await p.checkDomain('tickets.example.com')).status).toBe('pending_dns');
  });
});
