'use server';

import { setAttendeeLabelsCommand } from '@yayatoh/attendees';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export type LabelState = { readonly ok: boolean; readonly code: string | null };

export async function addLabelAction(
  org: string,
  event: string,
  attendeeId: string,
  _prev: LabelState,
  form: FormData,
): Promise<LabelState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      setAttendeeLabelsCommand,
      { eventId: ev.id, attendeeIds: [attendeeId], add: [String(form.get('label') ?? '')] },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/attendees`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}

export async function removeLabelAction(
  org: string,
  event: string,
  attendeeId: string,
  label: string,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(
    setAttendeeLabelsCommand,
    { eventId: ev.id, attendeeIds: [attendeeId], remove: [label] },
    data.ctx,
    ports,
  );
  revalidatePath(`/o/${org}/e/${event}/attendees`);
}
