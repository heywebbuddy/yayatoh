import 'server-only';
import { isTwoFactorError, type StepUpMethod, type StepUpProof } from '@yayatoh/auth';
import { headers } from 'next/headers';
import { getAuth, getTwoFactor } from './auth.ts';
import type { Staff } from './staff.ts';

/** How this staff member confirms it's them in a form: their authenticator, else their password. */
export async function staffProofMethod(staff: Staff): Promise<StepUpMethod> {
  return getTwoFactor().method(staff.userId);
}

/**
 * The staff member confirms it's them in the same form as a sensitive change (authenticator code,
 * else password; audited in packages/auth). `method`: they have neither, so nothing can confirm.
 */
export async function confirmStaff(
  staff: Staff,
  form: FormData,
): Promise<
  { ok: true; at: Date } | { ok: false; code: 'method' | 'rate_limited' | 'step_up' | 'signed_out' }
> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return { ok: false, code: 'signed_out' };
  const twoFactor = getTwoFactor();
  const method = await twoFactor.method(staff.userId);
  if (method === 'email') return { ok: false, code: 'method' };
  const proof: StepUpProof =
    method === 'totp'
      ? { method: 'totp', code: String(form.get('code') ?? '') }
      : { method: 'password', password: String(form.get('password') ?? '') };
  try {
    const at = await twoFactor.stepUp({ userId: staff.userId, sessionToken: session.session.token, proof });
    return { ok: true, at };
  } catch (err) {
    if (!isTwoFactorError(err)) throw err;
    return { ok: false, code: err.code === 'rate_limited' ? 'rate_limited' : 'step_up' };
  }
}
