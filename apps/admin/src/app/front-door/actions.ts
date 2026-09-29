'use server';

import { isTwoFactorError, type StepUpProof } from '@yayatoh/auth';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth, getTwoFactor } from '@/server/auth.ts';
import { FlagChangeInput, routeAllowed, setFrontDoorFlag } from '@/server/front-door-store.ts';
import { requireStaff } from '@/server/staff.ts';

/**
 * Move one route on one host between the legacy site and the new app (M2.4a; admins only). A
 * reason is required and the staff member confirms it's them in the same form (authenticator
 * code, else password). The change, who made it, why and the step-up time are recorded together
 * (`platform.front_door_flag_changes`), and the platform access log names the staff member.
 */
export async function setFrontDoorFlagAction(form: FormData) {
  const staff = await requireStaff('frontDoor');
  const fail = (code: string): never => redirect(`/front-door?error=${code}#change`);
  const parsed = FlagChangeInput.safeParse({
    host: String(form.get('host') ?? ''),
    route: String(form.get('route') ?? ''),
    state: String(form.get('state') ?? ''),
    reason: String(form.get('reason') ?? ''),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    fail(field === 'reason' ? 'reason' : 'invalid');
  }
  const input = parsed.data as FlagChangeInput;
  if (!routeAllowed(input.host, input.route)) fail('invalid');

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const twoFactor = getTwoFactor();
  const method = await twoFactor.method(staff.userId);
  if (method === 'email') fail('method');
  const proof: StepUpProof =
    method === 'totp'
      ? { method: 'totp', code: String(form.get('code') ?? '') }
      : { method: 'password', password: String(form.get('password') ?? '') };
  let steppedUpAt: Date | null = null;
  let stepUpError: string | null = null;
  try {
    steppedUpAt = await twoFactor.stepUp({
      userId: staff.userId,
      sessionToken: session.session.token,
      proof,
    });
  } catch (err) {
    if (!isTwoFactorError(err)) throw err;
    stepUpError = err.code === 'rate_limited' ? 'rate_limited' : 'step_up';
  }
  if (stepUpError || !steppedUpAt) fail(stepUpError ?? 'step_up');

  await setFrontDoorFlag(staff.actor, input, steppedUpAt as Date);
  revalidatePath('/front-door');
  redirect(`/front-door?done=changed#routes`);
}
