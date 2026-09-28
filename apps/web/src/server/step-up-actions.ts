'use server';

import { isTwoFactorError, type StepUpMethod, type StepUpProof } from '@yayatoh/auth';
import { getTwoFactor } from './auth.ts';
import { ownSession, sessionToken } from './session.ts';

export interface StepUpStart {
  readonly ok: boolean;
  readonly method: StepUpMethod | null;
}

/**
 * Opening "Confirm it's you": which proof this person gives (their authenticator, else their
 * password, else a code we email now). Re-calling it emails a new code.
 */
export async function beginStepUpAction(): Promise<StepUpStart> {
  const session = await ownSession();
  if (!session) return { ok: false, method: null };
  const tf = getTwoFactor();
  const method = await tf.method(session.userId);
  if (method === 'email') await tf.sendStepUpEmail(session.userId, session.email);
  return { ok: true, method };
}

export interface StepUpState {
  readonly ok: boolean;
  readonly code: 'invalid_code' | 'invalid_password' | 'rate_limited' | 'unauthenticated' | null;
}

/** Check the proof and restart this session's fresh window (10 minutes). Audited in packages/auth. */
export async function confirmStepUpAction(_prev: StepUpState, form: FormData): Promise<StepUpState> {
  const session = await ownSession();
  const token = await sessionToken();
  if (!session || !token) return { ok: false, code: 'unauthenticated' };
  const method = String(form.get('method') ?? '');
  const proof: StepUpProof =
    method === 'password'
      ? { method: 'password', password: String(form.get('password') ?? '') }
      : { method: method === 'email' ? 'email' : 'totp', code: String(form.get('code') ?? '') };
  try {
    await getTwoFactor().stepUp({ userId: session.userId, sessionToken: token, proof });
    return { ok: true, code: null };
  } catch (err) {
    if (isTwoFactorError(err))
      return {
        ok: false,
        code: err.code === 'rate_limited' || err.code === 'invalid_password' ? err.code : 'invalid_code',
      };
    throw err;
  }
}
