'use server';

import { createCheckpointCommand, setSelfCheckinCommand } from '@yayatoh/checkin';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type SessionDoorFormState = {
  readonly ok: boolean;
  readonly code: string | null;
  /** The field a validation error is about. */
  readonly field?: 'name' | 'sessionId' | 'capacity' | null;
};

/** M5.6a: a door for one session (its three gates), optionally with a self check-in flyer. */
export async function createSessionDoorAction(
  org: string,
  event: string,
  _prev: SessionDoorFormState,
  form: FormData,
): Promise<SessionDoorFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'onsite');
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { ok: false, code: 'validation_failed', field: 'name' };
  const sessionId = String(form.get('sessionId') ?? '');
  if (!sessionId) return { ok: false, code: 'validation_failed', field: 'sessionId' };
  const rawCapacity = String(form.get('capacity') ?? '').trim();
  const capacity = rawCapacity === '' ? null : Number(rawCapacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 1_000_000))
    return { ok: false, code: 'validation_failed', field: 'capacity' };
  try {
    await executeCommand(
      createCheckpointCommand,
      {
        eventId: ev.id,
        name,
        kind: 'session',
        sessionId,
        capacity,
        selfCheckin: form.get('selfCheckin') === 'on',
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    const field = isDomainError(err) ? (err.details as { field?: string } | undefined)?.field : undefined;
    return {
      ok: false,
      code: isDomainError(err) ? err.code : 'internal',
      field: field === 'name' || field === 'sessionId' ? field : null,
    };
  }
  revalidatePath(`/o/${org}/e/${event}/onsite/sessions`);
  return { ok: true, code: null };
}

export async function setSelfCheckinAction(
  org: string,
  event: string,
  checkpointId: string,
  enabled: boolean,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'onsite');
  await executeCommand(setSelfCheckinCommand, { eventId: ev.id, checkpointId, enabled }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/onsite/sessions`);
}
