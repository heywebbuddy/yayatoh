'use server';

import { removeDoorStaffCommand, setDoorStaffCommand } from '@yayatoh/checkin';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type DoorStaffFormState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved'; readonly seq: number }
  | { readonly kind: 'error'; readonly code: string; readonly field: string | null; readonly seq: number };

const seqOf = (prev: DoorStaffFormState) => (prev.kind === 'idle' ? 0 : prev.seq) + 1;

/** Add a member as door staff, or change where they scan. No checkpoint ticked = the whole event. */
export async function saveDoorStaffAction(
  org: string,
  event: string,
  prev: DoorStaffFormState,
  form: FormData,
): Promise<DoorStaffFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'onsite');
  const seq = seqOf(prev);
  const userId = String(form.get('userId') ?? '');
  if (!userId) return { kind: 'error', code: 'validation_failed', field: 'userId', seq };
  const checkpointIds = form.getAll('checkpointIds').map(String);
  try {
    await executeCommand(setDoorStaffCommand, { eventId: ev.id, userId, checkpointIds }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/onsite`, 'layout');
    return { kind: 'saved', seq };
  } catch (err) {
    const field = isDomainError(err) && typeof err.details?.field === 'string' ? err.details.field : null;
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal', field, seq };
  }
}

export async function removeDoorStaffAction(org: string, event: string, userId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'onsite');
  await executeCommand(removeDoorStaffCommand, { eventId: ev.id, userId }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/onsite`, 'layout');
}
