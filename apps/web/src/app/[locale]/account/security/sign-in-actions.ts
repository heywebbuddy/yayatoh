'use server';

import {
  isSocialProvider,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  trustedDeviceCookie,
  unlinkSocialAccount,
} from '@yayatoh/auth';
import { isStepUpFresh } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { requestHost } from '@/server/request-origin.ts';
import { ownSession } from '@/server/session.ts';
import { beginSocial, SOCIAL_STATE_MAX_AGE_S, socialStateCookie } from '@/server/social.ts';

/**
 * Account security, M1.2f: linking and unlinking Google/Apple (both need a recent step-up: they
 * change how someone can get into the account), and trusted devices (revoking only takes access
 * away, so it needs no step-up). Always the person's own session, never an impersonation.
 */
export interface MethodState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly url?: string;
}

export async function startLinkAction(provider: string): Promise<MethodState> {
  const session = await ownSession();
  if (!session) return { ok: false, code: 'unauthenticated' };
  if (!isSocialProvider(provider)) return { ok: false, code: 'not_found' };
  if (!isStepUpFresh(session.stepUpAt, new Date())) return { ok: false, code: 'step_up_required' };
  const started = await beginSocial({
    provider,
    locale: await getLocale(),
    intent: 'link',
    userId: session.userId,
    next: '/account/security',
    handoff: null,
  });
  if (!started) return { ok: false, code: 'unavailable' };
  const https = (await requestHost()).protocol === 'https:';
  (await cookies()).set(socialStateCookie(https), started.state, {
    httpOnly: true,
    secure: https,
    sameSite: 'lax',
    path: '/',
    maxAge: SOCIAL_STATE_MAX_AGE_S,
  });
  return { ok: true, code: null, url: started.url };
}

export async function unlinkAction(_prev: MethodState, form: FormData): Promise<MethodState> {
  const session = await ownSession();
  if (!session) return { ok: false, code: 'unauthenticated' };
  const provider = String(form.get('provider') ?? '');
  if (!isSocialProvider(provider)) return { ok: false, code: 'not_linked' };
  if (!isStepUpFresh(session.stepUpAt, new Date())) return { ok: false, code: 'step_up_required' };
  const r = await unlinkSocialAccount(session.userId, provider);
  if (r !== 'unlinked') return { ok: false, code: r };
  revalidatePath('/account/security');
  return { ok: true, code: 'unlinked' };
}

export async function revokeDeviceAction(_prev: MethodState, form: FormData): Promise<MethodState> {
  const session = await ownSession();
  if (!session) return { ok: false, code: 'unauthenticated' };
  const ok = await revokeTrustedDevice(session.userId, String(form.get('id') ?? '').slice(0, 64));
  if (!ok) return { ok: false, code: 'not_found' };
  revalidatePath('/account/security');
  return { ok: true, code: 'revoked' };
}

export async function revokeAllDevicesAction(_prev: MethodState, _form: FormData): Promise<MethodState> {
  const session = await ownSession();
  if (!session) return { ok: false, code: 'unauthenticated' };
  await revokeAllTrustedDevices(session.userId, 'revoked');
  // This browser's cookie is useless now; drop it too.
  const https = (await requestHost()).protocol === 'https:';
  (await cookies()).delete(trustedDeviceCookie(https));
  revalidatePath('/account/security');
  return { ok: true, code: 'revoked_all' };
}
