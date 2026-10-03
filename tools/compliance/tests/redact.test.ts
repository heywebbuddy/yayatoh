import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { allCanaries, customerCanaries, secretCanaries } from '../src/canaries.ts';
import { redactText, redactValue, scanBundle, scanText } from '../src/redact.ts';

// Token-shaped strings are assembled here so no literal ever reaches the repo's gitleaks scan.
const r = (n: number, ch = 'a1B2') => ch.repeat(Math.ceil(n / ch.length)).slice(0, n);
const kinds = (text: string) => scanText(text).map((f) => f.kind);

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('redaction rules', () => {
  it('allows only .test emails', () => {
    expect(kinds('owner pani@lakeside.test and buyer@alpha-1.test')).toEqual([]);
    expect(kinds('reach me at jane.doe@gmail.com')).toEqual(['email']);
    expect(kinds('noreply@anthropic.com')).toEqual(['email']);
    expect(kinds('bot@users.noreply.github.com')).toEqual(['email']);
    expect(redactText('a jane@corp.example.com b pani@lakeside.test')).toBe(
      'a [redacted:email] b pani@lakeside.test',
    );
  });

  it('finds provider tokens and keys', () => {
    expect(kinds(`${'gh'}p_${r(36)}`)).toEqual(['github_token']);
    expect(kinds(`${'github'}_pat_${r(60, 'A_1b')}`)).toEqual(['github_token']);
    expect(kinds(`${'sk'}_live_${r(24)}`)).toEqual(['stripe_key']);
    expect(kinds(`${'wh'}sec_${r(32)}`)).toEqual(['stripe_key']);
    expect(kinds(`${'AK'}IA${r(16, 'ABCD2345')}`)).toEqual(['aws_key']);
    expect(kinds(`${'xo'}xb-${r(24)}`)).toEqual(['slack_token']);
    expect(kinds(['-----BEGIN', 'PRIVATE KEY-----'].join(' '))).toEqual(['private_key']);
    expect(kinds(`${'ey'}J${r(20)}.${'ey'}J${r(20)}.${r(20)}`)).toEqual(['jwt']);
    expect(kinds(`${'dp'}.st.${r(40)}`)).toEqual(['doppler_token']);
    // The password@host part also reads as an email: two findings for one leak is fine.
    expect(kinds(`postgres://app_user:${r(12)}@db.example.net:5432/x`)).toContain('db_url_password');
    expect(kinds(`Authorization: ${'Bearer'} ${r(40)}`)).toEqual(['bearer_token']);
    expect(kinds(`BETTER_AUTH_SECRET=${r(64, '0f')}`)).toEqual(['secret_assignment']);
    expect(kinds(`"api_key": "${r(32)}"`)).toEqual(['secret_assignment']);
  });

  it('finds IP addresses but not loopback, versions, times or hashes', () => {
    expect(kinds('client 10.1.2.3')).toEqual(['ipv4']);
    expect(kinds('client 2001:db8:85a3::8a2e:370:7334')).toEqual(['ipv6']);
    expect(kinds('127.0.0.1 and 0.0.0.0')).toEqual([]);
    expect(kinds('node 24.21.0, pnpm 12.6.0, WCAG 2.4.11, at 12:34:56')).toEqual([]);
    expect(kinds('999.1.1.1')).toEqual([]);
    expect(kinds('sha256 b5f72f8a7b799a9ede5da95a87d787f96c57b66ded8ed1e4f04260bfdcee5101')).toEqual([]);
    expect(kinds('id 01a0edfa-4519-7e98-8f96-728cbc0eb514 at 2026-09-29T16:23:17.014Z')).toEqual([]);
  });

  it('finds card numbers by Luhn only', () => {
    expect(kinds('card 4242 4242 4242 4242')).toEqual(['card_number']);
    expect(kinds('card 4111-1111-1111-1111')).toEqual(['card_number']);
    expect(kinds('run 4242424242424241')).toEqual([]);
    expect(kinds('run id 17234567890')).toEqual([]);
    // A Luhn-valid run inside a hex digest or an id is not a card (batch 3g merge).
    expect(kinds(`${'ab'}4242424242424242${'cd'.repeat(23)}  audit/audit-samples.json`)).toEqual([]);
    expect(kinds('ref x4242424242424242y')).toEqual([]);
    expect(kinds('card: 4242424242424242\n')).toEqual(['card_number']);
  });

  it('never echoes the value it found', () => {
    const token = `${'gh'}p_${r(36)}`;
    const [f] = scanText(`x ${token}`, 'f.json');
    expect(f).toMatchObject({ file: 'f.json', line: 1, kind: 'github_token' });
    expect(f?.preview).not.toContain(token.slice(4, 30));
  });

  it('redacts deeply, keys included, leaving numbers and booleans', () => {
    const v = redactValue({
      title: 'Fix for jane@corp.example.com',
      nested: [{ note: `${'sk'}_test_${r(24)}` }],
      'owner@corp.example.com': true,
      n: 42,
    });
    expect(v).toEqual({
      title: 'Fix for [redacted:email]',
      nested: [{ note: '[redacted:stripe_key]' }],
      '[redacted:email]': true,
      n: 42,
    });
    expect(scanText(JSON.stringify(v))).toEqual([]);
  });

  it('every planted canary is caught, secret and customer alike, with fresh values each time', () => {
    for (const c of allCanaries()) expect(scanText(c.content, c.file).length, c.name).toBeGreaterThan(0);
    expect(secretCanaries()[0]?.content).not.toBe(secretCanaries()[0]?.content);
    expect(new Set(customerCanaries().map((c) => c.class))).toEqual(new Set(['customer']));
  });

  it('scans a bundle directory recursively and refuses binary files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'a/b'), { recursive: true });
    writeFileSync(join(dir, 'a/ok.json'), '{"owner":"pani@lakeside.test"}\n');
    expect(scanBundle(dir)).toMatchObject({ ok: true, files: 1 });
    writeFileSync(join(dir, 'a/b/leak.md'), 'line one\ncontact jane@corp.example.com\n');
    writeFileSync(join(dir, 'a/b/blob.bin'), Buffer.from([1, 0, 2]));
    const report = scanBundle(dir);
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => `${f.file}:${f.line}:${f.kind}`).sort()).toEqual([
      'a/b/blob.bin:0:secret_assignment',
      'a/b/leak.md:2:email',
    ]);
  });
});
