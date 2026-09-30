import { describe, expect, it } from 'vitest';
import {
  FAKE_HUMAN_FAIL_TOKEN,
  FAKE_HUMAN_TOKEN,
  fakeHumanCheck,
  turnstileHumanCheck,
} from '../src/human-check.ts';
import { windowStart } from '../src/rate-limit.ts';

describe('human check port', () => {
  it('the fake adapter passes only its own token', async () => {
    expect(await fakeHumanCheck.verify(FAKE_HUMAN_TOKEN)).toBe(true);
    expect(await fakeHumanCheck.verify('')).toBe(false);
    expect(await fakeHumanCheck.verify('anything')).toBe(false);
    // M1.2f: the always-fail token tests use for the "check failed" path.
    expect(await fakeHumanCheck.verify(FAKE_HUMAN_FAIL_TOKEN)).toBe(false);
    expect(fakeHumanCheck.siteKey).toBeNull();
  });

  it('Turnstile posts the secret, token and IP to siteverify and trusts only success: true', async () => {
    const calls: { url: string; body: string }[] = [];
    const reply = (json: unknown, ok = true) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body) });
        return new Response(JSON.stringify(json), { status: ok ? 200 : 500 });
      }) as typeof fetch;
    const pass = turnstileHumanCheck({ siteKey: 'site', secretKey: 'sec', fetch: reply({ success: true }) });
    expect(pass.provider).toBe('turnstile');
    expect(pass.siteKey).toBe('site');
    expect(await pass.verify('tok', '203.0.113.9')).toBe(true);
    expect(calls[0]?.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(new URLSearchParams(calls[0]?.body)).toEqual(
      new URLSearchParams({ secret: 'sec', response: 'tok', remoteip: '203.0.113.9' }),
    );
    const fail = turnstileHumanCheck({ siteKey: 's', secretKey: 'k', fetch: reply({ success: false }) });
    expect(await fail.verify('tok')).toBe(false);
    const broken = turnstileHumanCheck({
      siteKey: 's',
      secretKey: 'k',
      fetch: reply({ success: true }, false),
    });
    expect(await broken.verify('tok')).toBe(false);
    const down = turnstileHumanCheck({
      siteKey: 's',
      secretKey: 'k',
      fetch: (async () => {
        throw new Error('offline');
      }) as typeof fetch,
    });
    expect(await down.verify('tok')).toBe(false);
    // Empty and oversized tokens never reach Cloudflare.
    const before = calls.length;
    expect(await pass.verify('')).toBe(false);
    expect(await pass.verify('x'.repeat(3000))).toBe(false);
    expect(calls.length).toBe(before);
  });
});

describe('rate-limit windows', () => {
  it('fixed windows start on the window boundary', () => {
    const at = new Date('2027-01-01T10:15:42.123Z');
    expect(windowStart(at, 60_000).toISOString()).toBe('2027-01-01T10:15:00.000Z');
    expect(windowStart(at, 3_600_000).toISOString()).toBe('2027-01-01T10:00:00.000Z');
  });
});
