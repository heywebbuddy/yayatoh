import { describe, expect, it } from 'vitest';
import {
  billingStanding,
  billingWriteRefused,
  DUNNING_GRACE_DAYS,
  NO_DUNNING,
  nextDunning,
  READ_ONLY_ALLOWED,
  readOnlySince,
} from '../src/dunning-rules.ts';

const DAY = 86_400_000;
const t0 = new Date('2026-10-01T12:00:00Z');
const at = (days: number) => new Date(t0.getTime() + days * DAY);

describe('dunning transitions (M6.6b)', () => {
  it('a failed renewal starts a grace period of DUNNING_GRACE_DAYS, once', () => {
    const first = nextDunning(NO_DUNNING, 'past_due', t0);
    expect(first.change).toBe('started');
    expect(first.state).toEqual({
      dunningStartedAt: t0,
      graceEndsAt: at(DUNNING_GRACE_DAYS),
      readOnlyAt: null,
    });
    // A retry that fails again changes nothing (the grace never restarts).
    const again = nextDunning(first.state, 'past_due', at(3));
    expect(again.change).toBeNull();
    expect(again.state).toBe(first.state);
  });

  it('the provider giving up (unpaid) makes the org read-only at once, in or out of dunning', () => {
    const grace = nextDunning(NO_DUNNING, 'past_due', t0).state;
    const hard = nextDunning(grace, 'unpaid', at(5));
    expect(hard.change).toBe('hardened');
    expect(hard.state).toEqual({
      dunningStartedAt: t0,
      graceEndsAt: at(DUNNING_GRACE_DAYS),
      readOnlyAt: at(5),
    });
    const direct = nextDunning(NO_DUNNING, 'unpaid', t0);
    expect(direct.state).toEqual({ dunningStartedAt: t0, graceEndsAt: t0, readOnlyAt: t0 });
    // Hardening twice keeps the first time.
    expect(nextDunning(hard.state, 'unpaid', at(9)).change).toBeNull();
  });

  it('a subscription that ends unpaid stays read-only; one the org cancels while paid up changes nothing', () => {
    const grace = nextDunning(NO_DUNNING, 'past_due', t0).state;
    expect(nextDunning(grace, 'canceled', at(2)).change).toBe('hardened');
    expect(nextDunning(grace, 'incomplete_expired', at(2)).change).toBe('hardened');
    expect(nextDunning(NO_DUNNING, 'canceled', t0)).toEqual({ state: NO_DUNNING, change: null });
    expect(nextDunning(NO_DUNNING, 'paused', t0).change).toBeNull();
  });

  it('a payment (active or trialing) clears everything', () => {
    const hard = nextDunning(nextDunning(NO_DUNNING, 'past_due', t0).state, 'unpaid', at(1)).state;
    expect(nextDunning(hard, 'active', at(2))).toEqual({ state: NO_DUNNING, change: 'resolved' });
    expect(nextDunning(hard, 'trialing', at(2)).change).toBe('resolved');
    expect(nextDunning(NO_DUNNING, 'active', t0)).toEqual({ state: NO_DUNNING, change: null });
  });

  it('standing: grace until the grace end (exclusive), then read-only with no job needed', () => {
    const s = nextDunning(NO_DUNNING, 'past_due', t0).state;
    expect(billingStanding(NO_DUNNING, t0)).toBe('good');
    expect(billingStanding(s, t0)).toBe('grace');
    expect(billingStanding(s, new Date(at(DUNNING_GRACE_DAYS).getTime() - 1))).toBe('grace');
    expect(billingStanding(s, at(DUNNING_GRACE_DAYS))).toBe('read_only');
    expect(readOnlySince(s)).toEqual(at(DUNNING_GRACE_DAYS));
    const hard = nextDunning(s, 'unpaid', at(4)).state;
    expect(billingStanding(hard, at(4))).toBe('read_only');
    expect(readOnlySince(hard)).toEqual(at(4));
    expect(readOnlySince(NO_DUNNING)).toBeNull();
  });
});

describe('who a read-only org refuses (M6.6b)', () => {
  const base = { standing: 'read_only' as const, command: 'program.createTrack' };
  it('members and API keys are refused; buyers, portals, devices and the platform are not', () => {
    expect(billingWriteRefused({ ...base, actorType: 'user', memberRole: 'owner' })).toBe(true);
    expect(billingWriteRefused({ ...base, actorType: 'user', memberRole: 'viewer' })).toBe(true);
    expect(billingWriteRefused({ ...base, actorType: 'api_key', memberRole: null })).toBe(true);
    expect(billingWriteRefused({ ...base, actorType: 'user', memberRole: null })).toBe(false);
    expect(billingWriteRefused({ ...base, actorType: 'anonymous', memberRole: null })).toBe(false);
    expect(billingWriteRefused({ ...base, actorType: 'portal', memberRole: null })).toBe(false);
    expect(billingWriteRefused({ ...base, actorType: 'system', memberRole: null })).toBe(false);
  });

  it('paying, changing the plan, exports, personal actions and the door still work', () => {
    for (const command of [
      'billing.payOutstanding',
      'billing.changePlan',
      'checkin.scanTicket',
      'notifications.markInboxRead',
    ])
      expect(READ_ONLY_ALLOWED.has(command)).toBe(true);
    for (const command of READ_ONLY_ALLOWED)
      expect(billingWriteRefused({ ...base, command, actorType: 'user', memberRole: 'owner' })).toBe(false);
    expect(billingWriteRefused({ ...base, category: 'export', actorType: 'user', memberRole: 'owner' })).toBe(
      false,
    );
    expect(billingWriteRefused({ ...base, category: 'money', actorType: 'user', memberRole: 'owner' })).toBe(
      true,
    );
  });

  it('nothing is refused in good standing or during grace', () => {
    for (const standing of ['good', 'grace'] as const)
      expect(billingWriteRefused({ ...base, standing, actorType: 'user', memberRole: 'owner' })).toBe(false);
  });
});
