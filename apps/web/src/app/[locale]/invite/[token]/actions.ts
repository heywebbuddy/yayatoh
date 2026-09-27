'use server';

import { createCtx } from '@yayatoh/kernel';
import { acceptInvitation } from '@yayatoh/tenancy';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getAuth } from '@/server/auth.ts';
import { ports } from '@/server/ports.ts';

export async function acceptInviteAction(token: string): Promise<void> {
  const locale = await getLocale();
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return redirect({ href: '/sign-in', locale });
  const ctx = createCtx({ actor: { type: 'user', userId: session.user.id }, locale });
  await acceptInvitation(
    ctx,
    token,
    { email: session.user.email, emailVerified: session.user.emailVerified },
    ports,
  );
  return redirect({ href: '/o', locale });
}
