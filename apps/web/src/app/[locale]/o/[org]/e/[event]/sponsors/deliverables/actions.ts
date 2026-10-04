'use server';

import { executeCommand } from '@yayatoh/kernel';
import {
  addSponsorDeliverableCommand,
  deleteSponsorDeliverableCommand,
  setSponsorDeliverableDoneCommand,
} from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** Sponsor deliverables, organizer side (M5.4b): add, tick off or reopen, delete. */
const done = (org: string, event: string) => {
  revalidatePath(`/o/${org}/e/${event}/sponsors/deliverables`);
  revalidatePath(`/o/${org}/e/${event}/sponsors/packages`);
};

export async function addDeliverableAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  try {
    await executeCommand(
      addSponsorDeliverableCommand,
      {
        eventId: ev.id,
        sponsorId: String(form.get('sponsorId') ?? ''),
        title: String(form.get('title') ?? ''),
        owner: String(form.get('owner') ?? ''),
        ownerName: textOrNull(form, 'ownerName'),
        dueDate: String(form.get('dueDate') ?? ''),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function setDeliverableDoneAction(
  org: string,
  event: string,
  deliverableId: string,
  isDone: boolean,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  await executeCommand(
    setSponsorDeliverableDoneCommand,
    { eventId: ev.id, deliverableId, done: isDone },
    data.ctx,
    ports,
  );
  done(org, event);
}

export async function deleteDeliverableAction(
  org: string,
  event: string,
  deliverableId: string,
): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  await executeCommand(deleteSponsorDeliverableCommand, { eventId: ev.id, deliverableId }, data.ctx, ports);
  done(org, event);
}
