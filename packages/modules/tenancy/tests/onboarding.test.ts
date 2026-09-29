import { describe, expect, it } from 'vitest';
import {
  initialOrgStatus,
  limitedRefusal,
  missingOnboardingSteps,
  REQUIRED_ONBOARDING_STEPS,
  signupPath,
} from '../src/domain/onboarding.ts';

describe('the open-signup switch decides the signup path (M3.11a)', () => {
  it('without a code: open → self-serve, closed → refused', () => {
    expect(signupPath({ code: undefined, openSignup: true })).toBe('open');
    expect(signupPath({ code: null, openSignup: false })).toBe('closed');
    expect(signupPath({ code: '   ', openSignup: false })).toBe('closed');
    expect(signupPath({ code: '', openSignup: true })).toBe('open');
  });

  it('a code always goes the invite way, switch on or off', () => {
    expect(signupPath({ code: 'YY-7KQ4-M2XR-P9TD', openSignup: false })).toBe('code');
    expect(signupPath({ code: 'YY-7KQ4-M2XR-P9TD', openSignup: true })).toBe('code');
  });

  it('self-serve orgs start limited; invited and staff-made orgs start active', () => {
    expect(initialOrgStatus('open')).toBe('limited');
    expect(initialOrgStatus('code')).toBe('active');
    expect(initialOrgStatus('direct')).toBe('active');
  });
});

describe('onboarding rules (M3.11a)', () => {
  it('requires terms, a privacy notice and a first event, in that order', () => {
    expect(REQUIRED_ONBOARDING_STEPS).toEqual(['terms', 'privacy', 'event']);
    expect(missingOnboardingSteps({})).toEqual(['terms', 'privacy', 'event']);
    expect(missingOnboardingSteps({ terms: true, event: true })).toEqual(['privacy']);
    // Recommended steps never hold an org back.
    expect(
      missingOnboardingSteps({ terms: true, privacy: true, event: true, brand: false, team: false }),
    ).toEqual([]);
  });

  it('a limited org may not start guest bulk messaging; other statuses are not limited here', () => {
    expect(limitedRefusal('limited', 'bulk_messaging')).toBe('org_limited');
    for (const s of ['active', 'suspended', 'terminated'])
      expect(limitedRefusal(s, 'bulk_messaging')).toBeNull();
  });
});
