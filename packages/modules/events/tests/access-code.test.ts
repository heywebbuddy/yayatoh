import { describe, expect, it } from 'vitest';
import { ACCESS_CODE_PATTERN, accessCodeProblem, normalizeAccessCode } from '../src/domain/access-code.ts';

const now = new Date('2027-05-01T12:00:00Z');
const code = { active: true, expiresAt: null, maxUses: null, uses: 0 };

describe('access codes (M1.4d)', () => {
  it('matches case-insensitively and ignores spaces', () => {
    expect(normalizeAccessCode(' vip-2027 ')).toBe('VIP-2027');
    expect(normalizeAccessCode('Vip 2027')).toBe('VIP2027');
    expect(ACCESS_CODE_PATTERN.test(normalizeAccessCode('vip-2027'))).toBe(true);
    expect(ACCESS_CODE_PATTERN.test('AB')).toBe(false);
    expect(ACCESS_CODE_PATTERN.test("VIP'; DROP")).toBe(false);
  });

  it('refuses inactive and expired codes', () => {
    expect(accessCodeProblem(code, now, true)).toBeNull();
    expect(accessCodeProblem({ ...code, active: false }, now, true)).toBe('inactive');
    expect(accessCodeProblem({ ...code, expiresAt: now }, now, true)).toBe('expired');
    expect(accessCodeProblem({ ...code, expiresAt: new Date(now.getTime() + 1) }, now, true)).toBeNull();
  });

  it('counts the use limit for new unlocks only', () => {
    const used = { ...code, maxUses: 2, uses: 2 };
    expect(accessCodeProblem(used, now, true)).toBe('used_up');
    // A visitor who already unlocked keeps their access.
    expect(accessCodeProblem(used, now, false)).toBeNull();
    expect(accessCodeProblem({ ...used, uses: 1 }, now, true)).toBeNull();
  });
});
