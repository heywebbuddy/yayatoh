'use server';

import { fakeRelayEmail, fakeSubject, isSocialProvider, signFakeCode } from '@yayatoh/auth';
import { redirect } from 'next/navigation';
import { fakeSocialSecret, socialMode, socialRedirectUri } from '@/server/social.ts';

export interface FakeConsentParams {
  readonly provider: string;
  readonly state: string;
  readonly nonce: string;
  readonly redirectUri: string;
}

export interface FakeConsentState {
  readonly code: 'email_required' | null;
}

/** Only our own callback for that provider can receive a fake code (never another origin). */
function checked(p: FakeConsentParams) {
  if (socialMode() !== 'fake' || !isSocialProvider(p.provider))
    throw new Error('fake social sign-in is disabled');
  if (p.redirectUri !== socialRedirectUri(p.provider)) throw new Error('unexpected redirect');
  return { ...p, provider: p.provider };
}

/**
 * The fake consent page's "Continue" (dev, preview and CI only): a signed code for the person
 * typed in, sent back to the callback like a provider would. "Email verified" off stands for a
 * provider account whose address the provider never confirmed; "Hide my email" (Apple) gives a
 * private relay address.
 */
export async function fakeConsentAction(
  params: FakeConsentParams,
  _prev: FakeConsentState,
  form: FormData,
): Promise<FakeConsentState> {
  const p = checked(params);
  const hide = p.provider === 'apple' && form.get('hide') === 'yes';
  const typed = String(form.get('email') ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 254);
  if (!hide && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) return { code: 'email_required' };
  const email = hide ? fakeRelayEmail() : typed;
  // The same person gets the same id each time; a hidden email keeps the typed person's id.
  const subject = fakeSubject(p.provider, typed || email);
  const code = signFakeCode(fakeSocialSecret(), {
    provider: p.provider,
    subject,
    email,
    emailVerified: hide || form.get('verified') === 'yes',
    name: String(form.get('name') ?? '')
      .trim()
      .slice(0, 200),
    nonce: p.nonce,
    redirectUri: p.redirectUri,
  });
  const back = new URL(p.redirectUri);
  back.searchParams.set('code', code);
  back.searchParams.set('state', p.state);
  redirect(back.toString());
}

/** "Cancel": the provider's access_denied, like a person closing the consent screen. */
export async function fakeCancelAction(params: FakeConsentParams): Promise<void> {
  const p = checked(params);
  const back = new URL(p.redirectUri);
  back.searchParams.set('error', 'access_denied');
  back.searchParams.set('state', p.state);
  redirect(back.toString());
}
