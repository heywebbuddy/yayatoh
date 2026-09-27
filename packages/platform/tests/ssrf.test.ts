import { describe, expect, it, vi } from 'vitest';
import {
  assertPublicUrl,
  expandIPv6,
  isBlockedAddress,
  pinnedLookup,
  type Resolver,
  safeFetch,
  type Transport,
} from '../src/security/ssrf.ts';

const publicResolver: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];

describe('SSRF: address classification', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '192.0.2.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1%eth0',
    'fec0::1',
    'ff02::1',
    '2001:db8::1',
    '2001:0::1',
    '2002:7f00:1::',
    '100::1',
    'not-an-ip',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '2a00:1450::1',
  ])('allows %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it('expands IPv6 forms', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(expandIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(expandIPv6('1::2::3')).toBeNull();
    expect(expandIPv6('1:2:3')).toBeNull();
  });
});

describe('SSRF: URL checks', () => {
  it.each([
    ['ftp://example.com/', 'scheme'],
    ['http://example.com/', 'scheme'],
    ['https://user:pw@example.com/', 'credentials'],
    ['https://example.com:8443/', 'port'],
    ['https://localhost/', 'host'],
    ['https://api.localhost/', 'host'],
    ['https://printer.local/', 'host'],
    ['https://metadata.internal/', 'host'],
    ['https://127.0.0.1/', 'address'],
    ['https://2130706433/', 'address'],
    ['https://0x7f.1/', 'address'],
    ['https://[::1]/', 'address'],
    ['https://[::ffff:169.254.169.254]/', 'address'],
    ['https://169.254.169.254/latest/meta-data', 'address'],
    ['not a url', 'malformed'],
  ])('refuses %s (%s)', async (url, reason) => {
    await expect(assertPublicUrl(url, { resolver: publicResolver })).rejects.toThrow(reason);
  });

  it('allows http only when asked', async () => {
    await expect(
      assertPublicUrl('http://example.com/', { allowHttp: true, resolver: publicResolver }),
    ).resolves.toBeTruthy();
  });

  it('refuses names that resolve to any private address (all answers are checked)', async () => {
    const mixed: Resolver = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    await expect(assertPublicUrl('https://rebind.test/', { resolver: mixed })).rejects.toThrow('address');
    const v6: Resolver = async () => [{ address: 'fd00::1', family: 6 }];
    await expect(assertPublicUrl('https://v6.test/', { resolver: v6 })).rejects.toThrow('address');
    const none: Resolver = async () => [];
    await expect(assertPublicUrl('https://none.test/', { resolver: none })).rejects.toThrow('dns');
    const fail: Resolver = () => Promise.reject(new Error('ENOTFOUND'));
    await expect(assertPublicUrl('https://fail.test/', { resolver: fail })).rejects.toThrow('dns');
  });
});

describe('SSRF: safeFetch', () => {
  const ok = (status = 200, headers: Record<string, string> = {}) => ({
    status,
    headers,
    body: new TextEncoder().encode('ok'),
  });

  it('pins the connection to the checked address (DNS rebinding)', async () => {
    // First answer public, every later answer loopback: a rebinding attack.
    let calls = 0;
    const rebinding: Resolver = async () => {
      calls++;
      return [{ address: calls === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }];
    };
    const transport = vi.fn<Transport>(async () => ok());
    await safeFetch('https://rebind.test/hook', { resolver: rebinding, transport });
    expect(calls).toBe(1);
    expect(transport.mock.calls[0]?.[0].address).toEqual({ address: '93.184.216.34', family: 4 });
    // The socket's lookup always answers with the pinned address.
    const lookup = pinnedLookup({ address: '93.184.216.34', family: 4 });
    const got = await new Promise((res) => lookup('rebind.test', {}, (_e, a) => res(a)));
    expect(got).toBe('93.184.216.34');
    const all = await new Promise((res) => lookup('rebind.test', { all: true }, (_e, a) => res(a)));
    expect(all).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('re-checks every redirect hop', async () => {
    const transport = vi.fn<Transport>(async (req) =>
      req.url.hostname === 'start.test' ? ok(302, { location: 'https://169.254.169.254/latest' }) : ok(),
    );
    await expect(safeFetch('https://start.test/', { resolver: publicResolver, transport })).rejects.toThrow(
      'address',
    );
    const toLocal = vi.fn<Transport>(async () => ok(301, { location: 'http://localhost/' }));
    await expect(
      safeFetch('https://start.test/', { resolver: publicResolver, transport: toLocal }),
    ).rejects.toThrow('scheme');
  });

  it('follows at most 3 redirects and turns a 303 into GET without the body', async () => {
    let n = 0;
    const loop = vi.fn<Transport>(async () => ok(302, { location: `https://hop${++n}.test/` }));
    await expect(safeFetch('https://a.test/', { resolver: publicResolver, transport: loop })).rejects.toThrow(
      'too many redirects',
    );
    expect(loop).toHaveBeenCalledTimes(4);

    const seen: { method: string; body?: string; auth?: string }[] = [];
    const post: Transport = async (req) => {
      seen.push({ method: req.method, body: req.body, auth: req.headers.authorization });
      return seen.length === 1 ? ok(303, { location: 'https://other.test/done' }) : ok();
    };
    const res = await safeFetch('https://a.test/', {
      method: 'POST',
      body: '{}',
      headers: { authorization: 'Bearer s' },
      resolver: publicResolver,
      transport: post,
    });
    expect(res.url).toBe('https://other.test/done');
    expect(seen).toEqual([
      { method: 'POST', body: '{}', auth: 'Bearer s' },
      // Credentials never follow to another origin.
      { method: 'GET', body: undefined, auth: undefined },
    ]);
  });
});
