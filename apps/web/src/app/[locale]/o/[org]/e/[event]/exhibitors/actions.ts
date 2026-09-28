'use server';

import { executeCommand } from '@yayatoh/kernel';
import { createExhibitorCommand, deleteExhibitorCommand, updateExhibitorCommand } from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/exhibitors`);

const fields = (form: FormData) => ({
  name: String(form.get('name') ?? ''),
  boothLabel: textOrNull(form, 'boothLabel'),
  websiteUrl: textOrNull(form, 'websiteUrl'),
  description: String(form.get('description') ?? ''),
});

export async function createExhibitorAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(createExhibitorCommand, { eventId: ev.id, ...fields(form) }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function updateExhibitorAction(
  org: string,
  event: string,
  exhibitorId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      updateExhibitorCommand,
      { eventId: ev.id, exhibitorId, ...fields(form) },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function deleteExhibitorAction(org: string, event: string, exhibitorId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(deleteExhibitorCommand, { eventId: ev.id, exhibitorId }, data.ctx, ports);
  done(org, event);
}
