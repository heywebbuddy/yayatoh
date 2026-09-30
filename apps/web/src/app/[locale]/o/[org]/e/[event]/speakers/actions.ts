'use server';

import { parseLinksText, SectionTextError } from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { createSpeakerCommand, deleteSpeakerCommand, updateSpeakerCommand } from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { purgeDeletedProgramMedia } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/speakers`);

function fields(form: FormData) {
  return {
    name: String(form.get('name') ?? ''),
    title: textOrNull(form, 'title'),
    company: textOrNull(form, 'company'),
    bio: String(form.get('bio') ?? ''),
    // One link per line, `Label | https://…` (the M1.4d links format).
    links: parseLinksText(String(form.get('links') ?? '')),
  };
}

function speakerFailure(err: unknown): ProgramFormState {
  if (err instanceof SectionTextError)
    return { ok: false, code: 'validation_failed', fields: ['links'], reason: err.reason, line: err.line };
  return failure(err);
}

export async function createSpeakerAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'speakers');
  try {
    await executeCommand(createSpeakerCommand, { eventId: ev.id, ...fields(form) }, data.ctx, ports);
  } catch (err) {
    return speakerFailure(err);
  }
  done(org, event);
  return success();
}

export async function updateSpeakerAction(
  org: string,
  event: string,
  speakerId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'speakers');
  try {
    await executeCommand(
      updateSpeakerCommand,
      { eventId: ev.id, speakerId, ...fields(form) },
      data.ctx,
      ports,
    );
  } catch (err) {
    return speakerFailure(err);
  }
  done(org, event);
  return success();
}

export async function deleteSpeakerAction(org: string, event: string, speakerId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'speakers');
  await executeCommand(deleteSpeakerCommand, { eventId: ev.id, speakerId }, data.ctx, ports);
  // M1.4h: the photo/logo goes with it (media's subscriber to the deletion event).
  await purgeDeletedProgramMedia(data.org.id);
  done(org, event);
}
