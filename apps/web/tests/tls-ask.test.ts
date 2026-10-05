import { describe, expect, it } from 'vitest';
import { tlsAllowed } from '../src/lib/tls-ask.ts';

const env = { MARKETPLACE_HOSTS: 'yayatoh.com,www.yayatoh.com', APP_HOSTS: 'app.yayatoh.com' };
const tenants = new Set(['lakeside.yayatoh.events', 'tickets.example.org']);
const resolve = async (host: string) => (tenants.has(host) ? { orgId: 'o' } : null);

describe('on-demand TLS check', () => {
  it('allows the platform hosts and hosts that resolve to an org', async () => {
    for (const d of ['yayatoh.com', 'app.yayatoh.com', 'lakeside.yayatoh.events', 'Tickets.Example.org.'])
      expect(await tlsAllowed(d, resolve, env)).toBe(true);
  });

  it('refuses unknown, empty and malformed hosts without looking them up', async () => {
    const asked: string[] = [];
    const spy = async (h: string) => {
      asked.push(h);
      return null;
    };
    for (const d of [null, '', 'unknown.example.com', 'localhost', '1.2.3.4:443', 'a b.com', 'x'.repeat(260)])
      expect(await tlsAllowed(d, spy, env)).toBe(false);
    expect(asked).toEqual(['unknown.example.com']);
  });
});
