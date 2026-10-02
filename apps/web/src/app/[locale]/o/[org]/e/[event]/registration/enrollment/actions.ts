'use server';

import { executeCommand } from '@yayatoh/kernel';
import {
  promoteSessionNowCommand,
  setEnrollmentSettingsCommand,
  setItemSessionsCommand,
} from '@yayatoh/registration';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** M5.2b: the organizer's session enrollment page (settings, what items give, promote now). */
async function run(org: string, event: string, fn: (eventId: string, ctx: never) => Promise<unknown>) {
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  try {
    await fn(ev.id, data.ctx as never);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/registration/enrollment`);
  return success();
}

export async function saveEnrollmentSettingsAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      setEnrollmentSettingsCommand,
      {
        eventId,
        promotion: String(form.get('promotion') ?? 'auto') as 'auto',
        offerMinutes: numberOrNull(form, 'offerMinutes') ?? 240,
      },
      ctx,
      ports,
    ),
  );
}

export async function saveItemSessionsAction(
  org: string,
  event: string,
  admissionItemId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const sessionIds = form.getAll('sessionIds').map(String);
  return run(org, event, (eventId, ctx) =>
    executeCommand(setItemSessionsCommand, { eventId, admissionItemId, sessionIds }, ctx, ports),
  );
}

/** "Promote now": the result says how many people moved off the line. */
export async function promoteNowAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: FormState & { promoted?: number },
): Promise<FormState & { promoted?: number }> {
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  try {
    const r = await executeCommand(promoteSessionNowCommand, { eventId: ev.id, sessionId }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/registration/enrollment`);
    return { ...success(), promoted: r.promoted };
  } catch (err) {
    return failure(err);
  }
}
