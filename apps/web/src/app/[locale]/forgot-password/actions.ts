'use server';

import { getLocale } from 'next-intl/server';
import { localizedPath } from '@/lib/seo/urls.ts';
import { getAuth } from '@/server/auth.ts';
import { humanToken, requireHumanCheck } from '@/server/human-check.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

export interface ForgotState {
  readonly code: 'sent' | 'email' | 'human_required' | 'human_failed' | 'rate_limited' | null;
  readonly minutes?: number;
}

/**
 * "Forgot your password?" (M1.2f): after the human check and the emailed-code limits, a link to
 * choose a new password goes to the address (30 minutes, single use). The answer is the same
 * whether or not an account uses the address (no account discovery).
 */
export async function requestResetAction(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const email = String(form.get('email') ?? '')
    .trim()
    .slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { code: 'email' };
  const check = await requireHumanCheck(humanToken(form));
  if (check !== 'ok') return { code: check === 'missing' ? 'human_required' : 'human_failed' };
  const limit = await limitAction('otpSend', { identity: email, scope: 'password-reset' });
  if (!limit.allowed) return { code: 'rate_limited', minutes: retryAfterMinutes(limit) };
  try {
    await getAuth().api.requestPasswordReset({
      body: { email, redirectTo: localizedPath(await getLocale(), '/reset-password') },
    });
  } catch {
    // Unknown or erased addresses look the same as known ones.
  }
  return { code: 'sent' };
}
