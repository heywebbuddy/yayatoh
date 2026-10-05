import type { Resolver } from '@yayatoh/platform/ssrf';
import { describe, expect, it } from 'vitest';
import { fakeResolver } from '../src/config.ts';
import { endpointUrlProblem } from '../src/url.ts';

const publicDns: Resolver = async () => [{ address: '93.184.215.14', family: 4 }];
const privateDns: Resolver = async () => [{ address: '10.1.2.3', family: 4 }];

describe('endpoint URLs (SSRF at registration)', () => {
  it.each([
    ['https://hooks.example.com/yayatoh', null],
    ['https://hooks.example.com:443/x?token=abc', null],
    ['http://hooks.example.com/x', 'scheme'],
    ['ftp://hooks.example.com/x', 'scheme'],
    ['https://user:pw@hooks.example.com/x', 'credentials'],
    ['https://hooks.example.com:8443/x', 'port'],
    ['https://localhost/x', 'host'],
    ['https://db.internal/x', 'host'],
    ['https://127.0.0.1/x', 'address'],
    ['https://10.0.0.5/x', 'address'],
    ['https://169.254.169.254/latest/meta-data', 'address'],
    ['https://[::1]/x', 'address'],
    ['not a url', 'malformed'],
    [`https://hooks.example.com/${'a'.repeat(2100)}`, 'length'],
  ])('%s → %s', async (url, problem) => {
    expect(await endpointUrlProblem(url, publicDns)).toBe(problem);
  });

  it('refuses a name that resolves to a private address', async () => {
    expect(await endpointUrlProblem('https://sneaky.example.com/x', privateDns)).toBe('address');
  });

  it('the fake resolver maps reserved test names to a public address', async () => {
    expect(await fakeResolver('hooks.example.com')).toEqual([{ address: '93.184.215.14', family: 4 }]);
    expect(await fakeResolver('receiver.test')).toEqual([{ address: '93.184.215.14', family: 4 }]);
  });
});
