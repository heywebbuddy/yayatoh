'use server';

import { type ChallengeError, trustDevice, trustedDeviceCookie, verifySignInChallenge } from '@yayatoh/auth';
import { cookies, headers } from 'next/headers';
import { getAuth } from '@/server/auth.ts';
import { requestHost } from '@/server/request-origin.ts';

export interface ChallengeState {
  readonly ok: boolean;
  readonly code: ChallengeError | null;
}

/**
 * The sign-in's second step (two-step verification): a code from the authenticator app or a
 * backup code. Runs server-side so Better Auth's challenge limits apply and the session cookie is
 * set on success (next-cookies). "Trust this device for 30 days" (M1.2f) then gives this browser a
 * host-only cookie; later sign-ins here skip the second step until it expires or is revoked.
 */
export async function verifyChallengeAction(_prev: ChallengeState, form: FormData): Promise<ChallengeState> {
  const h = await headers();
  const r = await verifySignInChallenge(getAuth(), h, {
    kind: form.get('kind') === 'backup_code' ? 'backup_code' : 'totp',
    code: String(form.get('code') ?? ''),
  });
  if (!r.ok) return { ok: false, code: r.error };
  if (form.get('trust') === 'yes') {
    const here = await requestHost();
    const https = here.protocol === 'https:';
    const trusted = await trustDevice({
      userId: r.userId,
      host: h.get('host') ?? '',
      userAgent: h.get('user-agent'),
    });
    (await cookies()).set(trustedDeviceCookie(https), trusted.cookie, {
      httpOnly: true,
      secure: https,
      sameSite: 'lax',
      path: '/',
      expires: trusted.expiresAt,
    });
  }
  return { ok: true, code: null };
}

/**
 * Before asking for the second step (M1.2f): on a browser this person trusts, the pending sign-in
 * completes without a code. `false` means: ask for the code as usual.
 */
export async function skipChallengeOnTrustedDevice(): Promise<boolean> {
  const here = await requestHost();
  if (here.kind === 'tenant') return false;
  const h = await headers();
  const cookie = (await cookies()).get(trustedDeviceCookie(here.protocol === 'https:'))?.value ?? null;
  if (!cookie) return false;
  const r = await getAuth().api.redeemTrustedDevice({
    body: { cookie, host: h.get('host') ?? '' },
    headers: h,
  });
  return r.ok;
}
