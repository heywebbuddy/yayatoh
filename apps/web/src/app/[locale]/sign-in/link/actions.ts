'use server';

import { confirmLinkProof } from '@yayatoh/auth';
import { cookies, headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { getAuth } from '@/server/auth.ts';
import { requestHost } from '@/server/request-origin.ts';
import { afterSignIn, challengeUrl, type SignInTarget, safeNext } from '@/server/sign-in-finish.ts';
import { linkProofCookie } from '@/server/social.ts';

export interface LinkProofState {
  readonly url: string | null;
  readonly code: 'invalid_code' | 'expired' | 'too_many_attempts' | 'linked_elsewhere' | null;
}

/**
 * The code sent to the existing account's address (M1.2f): right, and the provider is linked and
 * the person signed in here (or asked for their second step); the proof is bound to this browser
 * (its cookie) and single use.
 */
export async function confirmLinkAction(
  target: { next: string; returnUrl: string | null; state: string | null },
  _prev: LinkProofState,
  form: FormData,
): Promise<LinkProofState> {
  const here = await requestHost();
  if (here.kind === 'tenant') return { url: null, code: 'expired' };
  const jar = await cookies();
  const name = linkProofCookie(here.protocol === 'https:');
  const id = jar.get(name)?.value ?? '';
  const r = await confirmLinkProof(getAuth(), id, String(form.get('code') ?? '').slice(0, 20));
  if (!r.ok) return { url: null, code: r.error };
  jar.delete(name);
  const signed = await getAuth().api.socialSession({ body: { userId: r.userId }, headers: await headers() });
  const t: SignInTarget = {
    locale: await getLocale(),
    next: safeNext(target.next),
    handoff: target.returnUrl && target.state ? { returnUrl: target.returnUrl, state: target.state } : null,
  };
  return { url: signed.challenge ? challengeUrl(t) : await afterSignIn(r.userId, t), code: null };
}
