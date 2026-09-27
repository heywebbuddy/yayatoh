'use server';

import { type ChallengeError, verifySignInChallenge } from '@yayatoh/auth';
import { headers } from 'next/headers';
import { getAuth } from '@/server/auth.ts';

export interface ChallengeState {
  readonly ok: boolean;
  readonly code: ChallengeError | null;
}

/** Second sign-in step for people with two-step verification: a TOTP or a backup code. */
export async function verifyChallengeAction(_prev: ChallengeState, form: FormData): Promise<ChallengeState> {
  const r = await verifySignInChallenge(getAuth(), await headers(), {
    kind: form.get('kind') === 'backup_code' ? 'backup_code' : 'totp',
    code: String(form.get('code') ?? ''),
  });
  return r.ok ? { ok: true, code: null } : { ok: false, code: r.error };
}
