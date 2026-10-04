'use server';

import { isTwoFactorError, type StepUpMethod, type StepUpProof } from '@yayatoh/auth';
import { devPersonaTotpSecret, secretKey, totp } from '@yayatoh/auth/totp';
import { getTwoFactor } from './auth.ts';
import { personaByEmail } from './personas.ts';
import { devAuthEnabled, getSession, ownSession, sessionToken } from './session.ts';

export interface StepUpStart {
  readonly ok: boolean;
  readonly method: StepUpMethod | null;
  /**
   * Why the dialog can't ask for a proof (U3): staff acting as the member can't confirm as them;
   * `failed` when starting failed (e.g. the emailed code could not be sent) and may be retried.
   */
  readonly problem?: 'impersonating' | 'unauthenticated' | 'failed';
  /**
   * Dev and preview only (U3): a seeded persona signed in with one click from /dev/login never
   * saw an authenticator, so the dialog offers to confirm as the persona instead.
   */
  readonly persona?: boolean;
}

/** The seeded persona behind this session, on dev/preview hosts only (never in production). */
function devPersona(email: string) {
  return devAuthEnabled() && process.env.DEV_PERSONA_PASSWORD ? personaByEmail(email) : undefined;
}

/**
 * Opening "Confirm it's you": which proof this person gives (their authenticator, else their
 * password, else a code we email now). Re-calling it emails a new code.
 */
export async function beginStepUpAction(): Promise<StepUpStart> {
  const session = await ownSession();
  if (!session) {
    const acting = (await getSession())?.impersonation;
    return { ok: false, method: null, problem: acting ? 'impersonating' : 'unauthenticated' };
  }
  const tf = getTwoFactor();
  try {
    const method = await tf.method(session.userId);
    if (method === 'email') await tf.sendStepUpEmail(session.userId, session.email);
    return { ok: true, method, persona: Boolean(devPersona(session.email)) && method !== 'email' };
  } catch {
    return { ok: false, method: null, problem: 'failed' };
  }
}

/**
 * Dev and preview only (U3): confirm a seeded persona's session with the persona's own proof,
 * answered by the server exactly as /dev/login answers its sign-in challenge (the real step-up,
 * audited and rate limited like any other). Refused for everyone else and in production.
 */
export async function confirmStepUpAsPersonaAction(): Promise<StepUpState> {
  const session = await ownSession();
  const token = await sessionToken();
  if (!session || !token) return { ok: false, code: 'unauthenticated' };
  const password = process.env.DEV_PERSONA_PASSWORD;
  const persona = devPersona(session.email);
  if (!persona || !password) return { ok: false, code: 'invalid_code' };
  const tf = getTwoFactor();
  const method = await tf.method(session.userId);
  const proof: StepUpProof | null =
    method === 'totp'
      ? {
          method: 'totp',
          code: totp(secretKey(devPersonaTotpSecret(persona.email, password)), Date.now()),
        }
      : method === 'password'
        ? { method: 'password', password }
        : null;
  if (!proof) return { ok: false, code: 'invalid_code' };
  try {
    await tf.stepUp({ userId: session.userId, sessionToken: token, proof });
    return { ok: true, code: null };
  } catch (err) {
    if (isTwoFactorError(err))
      return { ok: false, code: err.code === 'rate_limited' ? 'rate_limited' : 'invalid_code' };
    throw err;
  }
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
