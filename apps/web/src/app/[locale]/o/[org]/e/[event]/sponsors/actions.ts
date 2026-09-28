'use server';

import { executeCommand } from '@yayatoh/kernel';
import {
  createSponsorCommand,
  createSponsorTierCommand,
  deleteSponsorCommand,
  deleteSponsorTierCommand,
  updateSponsorCommand,
} from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/sponsors`);

const fields = (form: FormData) => ({
  tierId: String(form.get('tierId') ?? ''),
  name: String(form.get('name') ?? ''),
  websiteUrl: textOrNull(form, 'websiteUrl'),
  description: String(form.get('description') ?? ''),
});

export async function createTierAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      createSponsorTierCommand,
      {
        eventId: ev.id,
        name: String(form.get('name') ?? ''),
        position: numberOrNull(form, 'position') ?? Number.NaN,
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

/** Deleting a tier that still has sponsors is refused (`tier_in_use`), shown next to the button. */
export async function deleteTierAction(
  org: string,
  event: string,
  tierId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(deleteSponsorTierCommand, { eventId: ev.id, tierId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function createSponsorAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(createSponsorCommand, { eventId: ev.id, ...fields(form) }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function updateSponsorAction(
  org: string,
  event: string,
  sponsorId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      updateSponsorCommand,
      { eventId: ev.id, sponsorId, ...fields(form) },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function deleteSponsorAction(org: string, event: string, sponsorId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(deleteSponsorCommand, { eventId: ev.id, sponsorId }, data.ctx, ports);
  done(org, event);
}
