'use server';

import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getAuth } from '@/server/auth.ts';

export interface ResetState {
  readonly code: 'too_short' | 'too_long' | 'mismatch' | 'invalid_token' | null;
}

/**
 * Choose a new password with the emailed link's token (M1.2f). Every session ends, and so do
 * trusted devices and /v1 refresh tokens (packages/auth); then sign in with the new password.
 */
export async function resetPasswordAction(
  token: string,
  _prev: ResetState,
  form: FormData,
): Promise<ResetState> {
  const password = String(form.get('password') ?? '');
  if (password.length < 8) return { code: 'too_short' };
  if (password.length > 128) return { code: 'too_long' };
  if (password !== String(form.get('confirm') ?? '')) return { code: 'mismatch' };
  try {
    await getAuth().api.resetPassword({ body: { newPassword: password, token: token.slice(0, 200) } });
  } catch {
    return { code: 'invalid_token' };
  }
  const locale = await getLocale();
  redirect({ href: '/sign-in?reset=done', locale });
  return { code: null };
}
