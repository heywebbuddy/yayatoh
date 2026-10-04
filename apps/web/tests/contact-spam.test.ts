import { describe, expect, it } from 'vitest';
import { checkStamp, formStamp, honeypotFilled, MAX_FILL_MS, MIN_FILL_MS } from '../src/lib/contact-spam.ts';

const SECRET = 'a'.repeat(64);
const ORG = '01a102c8-b249-7226-9f2f-36d7270b7ec5';
const OTHER = '01a102c9-0d66-7f32-85ae-04a59877c438';

describe('U10 contact page spam checks', () => {
  const t0 = 1_800_000_000_000;
  const stamp = formStamp(SECRET, ORG, t0);

  it('accepts a form a person took a few seconds to fill', () => {
    expect(checkStamp(SECRET, ORG, stamp, t0 + MIN_FILL_MS)).toBe('ok');
    expect(checkStamp(SECRET, ORG, stamp, t0 + 60_000)).toBe('ok');
  });

  it('refuses forms sent back too fast, or too late', () => {
    expect(checkStamp(SECRET, ORG, stamp, t0 + 500)).toBe('too_fast');
    expect(checkStamp(SECRET, ORG, stamp, t0 + MAX_FILL_MS + 1)).toBe('expired');
  });

  it('refuses stamps that are forged, backdated, for another org or signed with another secret', () => {
    const [, org, sig] = stamp.split('.');
    expect(checkStamp(SECRET, ORG, `${t0 - 60_000}.${org}.${sig}`, t0)).toBe('invalid');
    expect(checkStamp(SECRET, OTHER, stamp, t0 + 10_000)).toBe('invalid');
    expect(checkStamp('b'.repeat(64), ORG, stamp, t0 + 10_000)).toBe('invalid');
    expect(checkStamp(SECRET, ORG, '', t0)).toBe('invalid');
    expect(checkStamp(SECRET, ORG, 'nonsense', t0)).toBe('invalid');
  });

  it('a filled honeypot is a bot; empty or blank is a person', () => {
    expect(honeypotFilled('https://spam.example')).toBe(true);
    expect(honeypotFilled('')).toBe(false);
    expect(honeypotFilled('   ')).toBe(false);
    expect(honeypotFilled(null)).toBe(false);
  });
});
