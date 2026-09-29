'use server';

import { createCtx, isDomainError } from '@yayatoh/kernel';
import { signUpOrganization } from '@yayatoh/tenancy';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getHumanCheck, passedHumanCheck } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { ownAuthSession } from '@/server/session.ts';

export type SignupState = {
  readonly code: string | null;
  readonly field?: string;
  /** With `rate_limited`: when to try again. */
  readonly minutes?: number;
};

/**
 * Create the organization (signed-in person + click-wrap), then open it. With a signup code as
 * before (M1.3b); without one only while open signup is on (M3.11a), after the abuse checks: a
 * verified email address, the `openSignup` rate limit (per device, IP and account) and the
 * "are you a person?" check. The command itself re-reads the switch inside its transaction.
 */
export async function signupAction(_prev: SignupState, form: FormData): Promise<SignupState> {
  const locale = await getLocale();
  const session = await ownAuthSession();
  if (!session) return { code: 'unauthenticated' };
  const code = String(form.get('code') ?? '').trim();
  if (!code) {
    if (!session.user.emailVerified) return { code: 'email_unverified' };
    const limit = await limitAction('openSignup', { identity: session.user.id });
    if (!limit.allowed) return { code: 'rate_limited', minutes: retryAfterMinutes(limit) };
    if (getHumanCheck() && (await passedHumanCheck(form)) !== true) return { code: 'human_check' };
  }
  let slug: string;
  try {
    const org = await signUpOrganization(
      createCtx({ actor: { type: 'user', userId: session.user.id }, locale }),
      {
        code,
        name: String(form.get('name') ?? ''),
        slug: String(form.get('slug') ?? '').toLowerCase(),
        defaultProfile: String(form.get('profile') ?? 'other'),
        timezone: String(form.get('timezone') ?? '') || undefined,
        defaultLocale: locale,
        acceptTerms: form.get('terms') === 'yes',
      },
      ports,
    );
    slug = org.slug;
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const d = err.details as { field?: unknown; reason?: unknown } | undefined;
    return {
      code: d?.reason === 'invalid_code' || d?.reason === 'signup_closed' ? (d.reason as string) : err.code,
      field: typeof d?.field === 'string' ? d.field : undefined,
    };
  }
  redirect({ href: `/o/${slug}`, locale });
  return { code: null };
}
