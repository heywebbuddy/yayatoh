'use server';

import { executeCommand } from '@yayatoh/kernel';
import { deleteProgramDocumentCommand } from '@yayatoh/media';
import {
  createSponsorCommand,
  createSponsorTierCommand,
  deleteSponsorCommand,
  deleteSponsorTierCommand,
  setSponsorTeamCommand,
  updateSponsorCommand,
} from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { purgeDeletedProgramMedia } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/sponsors`);

const fields = (form: FormData) => ({
  tierId: String(form.get('tierId') ?? ''),
  name: String(form.get('name') ?? ''),
  websiteUrl: textOrNull(form, 'websiteUrl'),
  description: String(form.get('description') ?? ''),
  longDescription: String(form.get('longDescription') ?? ''),
  contactEmail: textOrNull(form, 'contactEmail'),
  contactPhone: textOrNull(form, 'contactPhone'),
  videoUrl: textOrNull(form, 'videoUrl'),
});

export async function createTierAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
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
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
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
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
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
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
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
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  await executeCommand(deleteSponsorCommand, { eventId: ev.id, sponsorId }, data.ctx, ports);
  // M1.4h: the photo/logo goes with it (media's subscriber to the deletion event).
  await purgeDeletedProgramMedia(data.org.id);
  done(org, event);
}

/** The sponsor's team at the event: one line per person, `Name | Title | portal account email`. */
export async function setSponsorTeamAction(
  org: string,
  event: string,
  sponsorId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sponsors');
  const members = String(form.get('team') ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', title = '', accountEmail = ''] = line.split('|').map((p) => p.trim());
      return { name, title: title || null, accountEmail: accountEmail || null };
    });
  try {
    await executeCommand(setSponsorTeamCommand, { eventId: ev.id, sponsorId, members }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function deleteSponsorDocumentAction(
  org: string,
  event: string,
  documentId: string,
): Promise<void> {
  const { data } = await loadEvent(org, event, 'sponsors');
  await executeCommand(deleteProgramDocumentCommand, { documentId }, data.ctx, ports);
  done(org, event);
}
