import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = (app: 'mobile' | 'staff', name: string) =>
  readFileSync(join(repo, 'apps', app, '.maestro', 'scripts', name), 'utf8');

interface Call {
  method: 'GET' | 'POST';
  url: string;
  body?: string;
}

/** Runs a Maestro script the way Maestro does: plain JavaScript with `http`, `json`, `output` and the flow's env as globals. */
function run(code: string, env: Record<string, unknown>, replies: (call: Call) => unknown, now = 0) {
  const output: Record<string, unknown> = {};
  const calls: Call[] = [];
  const reply = (method: Call['method']) => (url: string, options?: { body?: string }) => {
    const call: Call = { method, url, ...(options?.body !== undefined ? { body: options.body } : {}) };
    calls.push(call);
    return { body: JSON.stringify(replies(call)) };
  };
  runInNewContext(code, {
    ...env,
    output,
    json: JSON.parse,
    http: { get: reply('GET'), post: reply('POST') },
    Date: { now: () => now },
    encodeURIComponent,
    Math,
    String,
    Error,
  });
  return { output, calls };
}

// The setup key is the base32 of the HMAC key (the UTF-8 bytes of the stored secret).
const base32 = (bytes: Buffer) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
};

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890" (the 6 low digits of the 8-digit values).
const RFC_KEY = base32(Buffer.from('12345678901234567890', 'utf8'));
const RFC_VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe("scripts/totp.js (the organizer's authenticator code)", () => {
  const code = script('staff', 'totp.js');

  it.each(RFC_VECTORS)('gives the RFC 6238 code at t=%i', (t, expected) => {
    expect(run(code, { SETUP_KEY: RFC_KEY }, () => ({}), t * 1000).output.totp).toBe(expected);
  });

  it('reads a setup key shown in groups of four, in any case', () => {
    const spaced = RFC_KEY.toLowerCase()
      .replace(/(.{4})/g, '$1 ')
      .trim();
    expect(run(code, { SETUP_KEY: spaced }, () => ({}), 59_000).output.totp).toBe('287082');
  });

  it("matches Node's HMAC for keys of any length, as the server computes it", () => {
    // The server's key is the UTF-8 bytes of a stored secret; the setup key is its base32.
    for (const secret of ['k', 'abcdefghij', 'A'.repeat(32), 'Zq9'.repeat(30)]) {
      for (const at of [1_700_000_000_000, 1_700_000_029_999, 1_700_000_030_000, 4_102_444_800_000]) {
        const counter = Buffer.alloc(8);
        counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
        const mac = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counter).digest();
        const offset = (mac[mac.length - 1] ?? 0) & 15;
        const bin = mac.readUInt32BE(offset) & 0x7fffffff;
        const expected = String(bin % 1_000_000).padStart(6, '0');
        const got = run(code, { SETUP_KEY: base32(Buffer.from(secret, 'utf8')) }, () => ({}), at).output.totp;
        expect(got).toBe(expected);
      }
    }
  });

  it('refuses a setup key that is not base32', () => {
    expect(() => run(code, { SETUP_KEY: 'not*base32' }, () => ({}), 0)).toThrow('base32');
  });
});

describe('the dev-server scripts', () => {
  const server = { DEV_SERVER: 'http://10.0.2.2:3000', DEV_PERSONA_PASSWORD: 'a'.repeat(14) };

  it('new-user.js makes an account and returns the password it was given, never one of its own', () => {
    const { output, calls } = run(script('mobile', 'new-user.js'), { ...server, TWO_FACTOR: '1' }, () => ({
      email: 'e2e-1@example.test',
      backupCodes: ['b1', 'b2'],
    }));
    expect(calls).toEqual([
      { method: 'POST', url: 'http://10.0.2.2:3000/api/dev/user', body: 'signIn=0&twoFactor=1' },
    ]);
    expect(output).toEqual({
      email: 'e2e-1@example.test',
      backupCode: 'b1',
      password: 'a'.repeat(14),
    });
  });

  it('new-user.js takes the server and the password from MAESTRO_ variables too, and refuses to run without one', () => {
    const viaPrefix = run(
      script('mobile', 'new-user.js'),
      { MAESTRO_DEV_SERVER: 'https://e2e.example.test', MAESTRO_DEV_PERSONA_PASSWORD: 'b'.repeat(14) },
      () => ({ email: 'e@example.test' }),
    );
    expect(viaPrefix.calls[0]?.url).toBe('https://e2e.example.test/api/dev/user');
    expect(viaPrefix.output.backupCode).toBe('');
    expect(() =>
      run(script('mobile', 'new-user.js'), { DEV_SERVER: 'http://localhost:3000' }, () => ({})),
    ).toThrow('DEV_PERSONA_PASSWORD');
  });

  it('new-event.js asks for a published event with a connected account and works out the search words', () => {
    const { output, calls } = run(script('mobile', 'new-event.js'), server, () => ({
      eventSlug: 'test-show-1abc2d',
    }));
    expect(calls[0]?.body).toBe('signIn=0&password=0&org=new&event=published&payouts=active');
    expect(output).toEqual({
      eventSlug: 'test-show-1abc2d',
      eventQuery: '1abc2d',
      eventName: 'Test Show 1abc2d',
    });
  });

  it('last-code.js and last-claim-link.js read the dev mailbox for one address', () => {
    const code = run(script('mobile', 'last-code.js'), { ...server, EMAIL: 'a+b@example.test' }, () => ({
      code: '123456',
    }));
    expect(code.calls[0]?.url).toBe('http://10.0.2.2:3000/api/dev/last-code?to=a%2Bb%40example.test');
    expect(code.output.code).toBe('123456');
    const claim = run(script('mobile', 'last-claim-link.js'), { ...server, EMAIL: 'b@example.test' }, () => [
      { to: 'b@example.test', text: 'Claim it: https://app.yayatoh.com/claim/AbC123_-xyz9?x=1' },
    ]);
    expect(claim.output.claimToken).toBe('AbC123_-xyz9');
    expect(() =>
      run(script('mobile', 'last-claim-link.js'), { ...server, EMAIL: 'b@example.test' }, () => []),
    ).toThrow('No claim link');
  });

  it('new-holder.js and the staff scripts return the fixtures their flows use', () => {
    const holder = run(script('mobile', 'new-holder.js'), server, () => ({
      people: [{ email: 'ana.x@example.test' }],
      myTickets: '/my-tickets/tok-123',
    }));
    expect(holder.output.holderEmail).toBe('ana.x@example.test');
    expect(holder.output.holderToken).toBe('tok-123');
    const organizer = run(script('staff', 'new-organizer.js'), server, () => ({
      email: 'o@example.test',
      setupKey: 'GEZD GNBV',
      backupCodes: ['bk1'],
      orgSlug: 'e2e-abc',
    }));
    expect(organizer.calls[0]?.body).toBe('signIn=0&twoFactor=1&org=new&event=published');
    expect(organizer.output).toMatchObject({
      email: 'o@example.test',
      setupKey: 'GEZD GNBV',
      backupCode: 'bk1',
      password: 'a'.repeat(14),
    });
    const exhibitor = run(script('staff', 'new-exhibitor.js'), server, () => ({
      admin: { email: 'admin.x@exhibitor.test', invite: '/event-portal/invite/abc' },
      people: [{ code: 'A1' }, { code: 'B2' }, { code: 'C3' }],
      exhibitor: 'Booth X',
    }));
    expect(exhibitor.output).toEqual({
      inviteLink: 'http://10.0.2.2:3000/event-portal/invite/abc',
      exhibitorEmail: 'admin.x@exhibitor.test',
      badgeCode: 'C3',
      exhibitorName: 'Booth X',
    });
  });
});
