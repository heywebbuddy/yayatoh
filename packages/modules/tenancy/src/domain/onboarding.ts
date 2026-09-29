import type { ONBOARDING_STEPS, SIGNUP_MODES } from '../schema.ts';

export type SignupMode = (typeof SIGNUP_MODES)[number];
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Which way a signup goes (M3.11a). A valid-looking code always goes the invite way, whether or
 * not open signup is on: invited organizers start fully active. Without a code, the platform
 * switch decides: open → a self-serve org (limited until onboarding is done), closed → refused.
 */
export function signupPath(s: {
  code: string | null | undefined;
  openSignup: boolean;
}): SignupMode | 'closed' {
  if (s.code?.trim()) return 'code';
  return s.openSignup ? 'open' : 'closed';
}

/** The status a new org starts in: self-serve orgs are `limited` until onboarding is complete. */
export function initialOrgStatus(mode: SignupMode): 'active' | 'limited' {
  return mode === 'open' ? 'limited' : 'active';
}

/**
 * Steps a self-serve org must finish to leave `limited` (pending the owner): accept the current
 * terms, publish a privacy notice (guests' data is processed on the organizer's behalf), and
 * create a first event. Brand, a teammate and payouts are recommended; payouts are needed anyway
 * before money is paid out (M1.3c), so they don't hold the org back.
 */
export const REQUIRED_ONBOARDING_STEPS: readonly OnboardingStep[] = ['terms', 'privacy', 'event'];

/** The required steps not done yet, in checklist order. */
export function missingOnboardingSteps(
  done: Readonly<Partial<Record<OnboardingStep, boolean>>>,
): OnboardingStep[] {
  return REQUIRED_ONBOARDING_STEPS.filter((s) => !done[s]);
}

/**
 * What a `limited` org can't do yet (M3.11a): start guest-facing bulk sends (attendee bulk email,
 * announcements, survey sends), the main abuse route for an account nobody has vetted. Everything
 * else works: building events, selling (funds stay on the platform until payouts are set up and
 * released), the team. Null when the capability is allowed.
 */
export function limitedRefusal(status: string, capability: 'bulk_messaging'): 'org_limited' | null {
  return status === 'limited' && capability === 'bulk_messaging' ? 'org_limited' : null;
}
