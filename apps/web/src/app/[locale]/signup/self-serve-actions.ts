'use server';

import { selfServePrice } from '@yayatoh/billing';
import { createCtx, isDomainError } from '@yayatoh/kernel';
import { openSignupEnabled, signUpOrganization } from '@yayatoh/tenancy';
import { headers } from 'next/headers';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getAuth } from '@/server/auth.ts';
import { getHumanCheck, passedHumanCheck } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { assignFreePlan, checkoutFor, myOrgBySlug } from '@/server/self-serve.ts';
import { ownAuthSession } from '@/server/session.ts';

export interface SelfServeState {
  /** What went wrong (shown as a message), or null. */
  readonly error:
    | null
    | 'unauthenticated'
    | 'email_unverified'
    | 'signup_closed'
    | 'rate_limited'
    | 'human_check'
    | 'plan_unavailable'
    | 'slug_taken'
    | 'invalid'
    | 'billing_off'
    | 'failed';
  readonly field?: string;
  readonly minutes?: number;
}

const text = (form: FormData, k: string) => String(form.get(k) ?? '').trim();
const PROFILES = ['wedding', 'gala', 'concert', 'conference', 'community', 'tour', 'agency', 'other'];

/**
 * Self-serve sign-up (open sign-up on): the signed-in person (email verified by their sign-in
 * code) creates their organization on the plan they picked. A free plan is switched on at once;
 * a paid plan goes to the provider's checkout and gets its modules only when the payment
 * succeeds (the webhook). Abuse checks as open sign-up always had: verified email, rate limit,
 * and the human check.
 */
export async function selfServeAction(_prev: SelfServeState, form: FormData): Promise<SelfServeState> {
  const locale = await getLocale();
  const session = await ownAuthSession();
  if (!session) return { error: 'unauthenticated' };
  if (!session.user.emailVerified) return { error: 'email_unverified' };
  if (!(await openSignupEnabled())) return { error: 'signup_closed' };
  const limit = await limitAction('openSignup', { identity: session.user.id });
  if (!limit.allowed) return { error: 'rate_limited', minutes: retryAfterMinutes(limit) };
  if (getHumanCheck() && (await passedHumanCheck(form)) !== true) return { error: 'human_check' };
  const interval = text(form, 'interval') === 'year' ? 'year' : 'month';
  const planKey = text(form, 'plan');
  const price = await selfServePrice(planKey, interval);
  if (!price) return { error: 'plan_unavailable' };
  const profile = PROFILES.includes(text(form, 'profile')) ? text(form, 'profile') : 'other';
  const name = text(form, 'orgName');
  const slug = text(form, 'slug').toLowerCase();
  const country = text(form, 'country').toUpperCase();
  if (name.length < 2 || !/^[A-Z]{2}$/.test(country))
    return { error: 'invalid', field: name.length < 2 ? 'orgName' : 'country' };
  let org: { id: string; slug: string };
  try {
    org = await signUpOrganization(
      createCtx({ actor: { type: 'user', userId: session.user.id }, locale }),
      {
        name,
        slug,
        defaultProfile: profile,
        timezone: text(form, 'timezone') || undefined,
        country,
        defaultLocale: locale,
        acceptTerms: form.get('terms') === 'yes',
      },
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const d = err.details as { field?: unknown; reason?: unknown } | undefined;
    if (d?.reason === 'signup_closed') return { error: 'signup_closed' };
    if (err.code === 'conflict' && d?.field === 'slug') return { error: 'slug_taken', field: 'slug' };
    return { error: 'invalid', ...(typeof d?.field === 'string' ? { field: d.field } : {}) };
  }
  const person = text(form, 'personName');
  if (person)
    await getAuth()
      .api.updateUser({ headers: await headers(), body: { name: person } })
      .catch(() => undefined);
  if (price.free) {
    await assignFreePlan(org.id, price.planKey);
    return redirect({ href: `/o/${org.slug}`, locale });
  }
  let url: string;
  try {
    url = await checkoutFor({
      orgId: org.id,
      slug: org.slug,
      email: session.user.email,
      planKey: price.planKey,
      interval,
    });
  } catch (err) {
    // The organization exists on the default plan: the payment page lets the person try again.
    void err;
    return redirect({
      href: `/signup/pay?org=${org.slug}&plan=${price.planKey}&interval=${interval}&failed=1`,
      locale,
    });
  }
  return nextRedirect(url);
}

/** Try the payment again for an organization created at sign-up (the person is its member). */
export async function resumePaymentAction(_prev: SelfServeState, form: FormData): Promise<SelfServeState> {
  const session = await ownAuthSession();
  if (!session) return { error: 'unauthenticated' };
  const org = await myOrgBySlug(session.user.id, text(form, 'org'));
  if (!org) return { error: 'invalid' };
  const interval = text(form, 'interval') === 'year' ? 'year' : 'month';
  const price = await selfServePrice(text(form, 'plan'), interval);
  if (!price || price.free) return { error: 'plan_unavailable' };
  let url: string;
  try {
    url = await checkoutFor({
      orgId: org.orgId,
      slug: org.slug,
      email: session.user.email,
      planKey: price.planKey,
      interval,
    });
  } catch (err) {
    return { error: String(err).includes('billing_off') ? 'billing_off' : 'failed' };
  }
  return nextRedirect(url);
}

/** Give up on paying: the organization keeps its start plan (free), and the person opens it. */
export async function continueWithoutPaymentAction(form: FormData) {
  const locale = await getLocale();
  const session = await ownAuthSession();
  if (!session) return redirect({ href: '/signup', locale });
  const org = await myOrgBySlug(session.user.id, text(form, 'org'));
  if (!org) return redirect({ href: '/signup', locale });
  return redirect({ href: `/o/${org.slug}`, locale });
}
