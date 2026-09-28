'use server';

import { createCtx, isDomainError } from '@yayatoh/kernel';
import { signUpOrganization } from '@yayatoh/tenancy';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { ownAuthSession } from '@/server/session.ts';

export type SignupState = { readonly code: string | null; readonly field?: string };

/** Create the organization (signed-in person + signup code + click-wrap), then open it. */
export async function signupAction(_prev: SignupState, form: FormData): Promise<SignupState> {
  const locale = await getLocale();
  const session = await ownAuthSession();
  if (!session) return { code: 'unauthenticated' };
  let slug: string;
  try {
    const org = await signUpOrganization(
      createCtx({ actor: { type: 'user', userId: session.user.id }, locale }),
      {
        code: String(form.get('code') ?? ''),
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
      code: d?.reason === 'invalid_code' ? 'invalid_code' : err.code,
      field: typeof d?.field === 'string' ? d.field : undefined,
    };
  }
  redirect({ href: `/o/${slug}`, locale });
  return { code: null };
}
