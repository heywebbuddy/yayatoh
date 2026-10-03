'use server';

import {
  addChecklistItemCommand,
  deleteChecklistItemCommand,
  setChecklistItemDoneCommand,
} from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** U6: the organizer's own checklist on the setup guide (items also come from templates). */
const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/setup-guide`);

export async function addOwnItemAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'setupGuide');
  try {
    await executeCommand(
      addChecklistItemCommand,
      { eventId: ev.id, title: String(form.get('title') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function setOwnItemDoneAction(org: string, event: string, itemId: string, value: boolean) {
  const { data, event: ev } = await loadEvent(org, event, 'setupGuide');
  await executeCommand(setChecklistItemDoneCommand, { eventId: ev.id, itemId, done: value }, data.ctx, ports);
  done(org, event);
}

export async function deleteOwnItemAction(org: string, event: string, itemId: string) {
  const { data, event: ev } = await loadEvent(org, event, 'setupGuide');
  await executeCommand(deleteChecklistItemCommand, { eventId: ev.id, itemId }, data.ctx, ports);
  done(org, event);
}
