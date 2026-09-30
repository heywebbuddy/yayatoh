'use server';

import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { CAP_SCOPES, liftAddressSuppressionCommand, setFrequencyCapsCommand } from '@yayatoh/notifications';
import { revalidatePath } from 'next/cache';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface LiftState {
  readonly error: 'note' | 'complaint_not_liftable' | 'forbidden' | 'not_found' | 'internal' | null;
  readonly note: string;
}

/** Lift one bounce suppression (owners and admins; note required; audited without the address). */
export async function liftSuppressionAction(
  org: string,
  id: string,
  _prev: LiftState,
  form: FormData,
): Promise<LiftState> {
  const data = await loadConsole(org);
  const note = String(form.get('note') ?? '').trim();
  if (note.length < 3) return { error: 'note', note };
  try {
    await executeCommand(liftAddressSuppressionCommand, { id, note }, data.ctx, ports);
  } catch (err) {
    const reason = isDomainError(err) ? String(err.details?.reason ?? '') : '';
    if (reason === 'complaint_not_liftable') return { error: 'complaint_not_liftable', note };
    if (isDomainError(err) && (err.code === 'forbidden' || err.code === 'not_found'))
      return { error: err.code, note };
    return { error: 'internal', note };
  }
  revalidatePath(`/o/${org}/messaging`);
  return redirect({ href: `/o/${org}/messaging?lifted=1`, locale: data.ctx.locale });
}

export interface CapsState {
  readonly saved: boolean;
  readonly errors: Readonly<Record<string, 'max' | 'window'>>;
  readonly code: string | null;
  readonly values: Readonly<Record<string, string>>;
}

const whole = (v: string, min: number, max: number) =>
  /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;

/** Save the org's frequency caps (every scope at once, from the form). */
export async function saveCapsAction(org: string, _prev: CapsState, form: FormData): Promise<CapsState> {
  const data = await loadConsole(org);
  const values: Record<string, string> = {};
  const errors: Record<string, 'max' | 'window'> = {};
  for (const scope of CAP_SCOPES) {
    const max = String(form.get(`${scope}.max`) ?? '').trim();
    const hours = String(form.get(`${scope}.hours`) ?? '').trim();
    values[`${scope}.max`] = max;
    values[`${scope}.hours`] = hours;
    if (!whole(max, 1, 20)) errors[`${scope}.max`] = 'max';
    if (!whole(hours, 1, 720)) errors[`${scope}.hours`] = 'window';
  }
  if (Object.keys(errors).length) return { saved: false, errors, code: 'validation_failed', values };
  try {
    await executeCommand(
      setFrequencyCapsCommand,
      {
        caps: CAP_SCOPES.map((scope) => ({
          scope,
          maxMessages: Number(values[`${scope}.max`]),
          windowHours: Number(values[`${scope}.hours`]),
        })),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return { saved: false, errors: {}, code: isDomainError(err) ? err.code : 'internal', values };
  }
  revalidatePath(`/o/${org}/messaging`);
  return { saved: true, errors: {}, code: null, values };
}
