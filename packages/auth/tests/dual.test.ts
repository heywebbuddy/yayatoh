import { describe, expect, it } from 'vitest';
import { dualHash, GRACE_DAYS, isDualHash, parseDualHash, verifyDualHash } from '../src/compat/index.ts';
import { needsRehash, verifyPassword } from '../src/password.ts';

// Synthetic test hashes ($2y$, cost 10) of 'synthetic-password' and 'synthetic-password-abc'.
const YAY = '$2y$10$LUQPdLgTiQhg7yN/rRTahOYFdNzq23OYlCi0s8O9KgLwIjCUmiSvy';
const ABC = '$2y$10$UyCHLqBjuFMmuEfkAAMwBu0ykRHf7PNRIJSiN3u0fXS8Sxwz8fmw6';

describe('dual-hash grace for merged legacy identities (T1, 180 days)', () => {
  const until = new Date('2027-05-01T00:00:00Z');
  const stored = dualHash(YAY, [ABC, YAY], until);

  it('stores both instances’ hashes, primary first, and parses them back', () => {
    expect(isDualHash(stored)).toBe(true);
    expect(GRACE_DAYS).toBe(180);
    expect(parseDualHash(stored)).toEqual({ until, primary: YAY, others: [ABC] });
    expect(parseDualHash('$yydual$x$abc')).toBeNull();
    expect(() => dualHash('plain', [ABC], until)).toThrow();
  });

  it('accepts either password during the grace period, only the primary after it', async () => {
    const during = new Date('2027-04-30T23:59:59Z');
    const after = new Date('2027-05-01T00:00:00Z');
    expect(await verifyDualHash('synthetic-password', stored, during)).toBe(true);
    expect(await verifyDualHash('synthetic-password-abc', stored, during)).toBe(true);
    expect(await verifyDualHash('wrong', stored, during)).toBe(false);
    expect(await verifyDualHash('synthetic-password', stored, after)).toBe(true);
    expect(await verifyDualHash('synthetic-password-abc', stored, after)).toBe(false);
  });

  it('is verified by the sign-in hook and rehashed to Argon2id after a sign-in', async () => {
    const live = dualHash(YAY, [ABC], new Date(Date.now() + 86_400_000));
    expect(await verifyPassword({ hash: live, password: 'synthetic-password-abc' })).toBe(true);
    expect(await verifyPassword({ hash: live, password: 'nope' })).toBe(false);
    expect(needsRehash(live)).toBe(true);
    expect(needsRehash(YAY)).toBe(true);
  });
});
