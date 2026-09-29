'use server';

import { executeCommand, zonedTimeToUtc } from '@yayatoh/kernel';
import { catchUpSpeakerPhotos } from '@yayatoh/media';
import {
  assignNewSpeakersCommand,
  createPortalTaskCommand,
  decideSpeakerChangeCommand,
  deletePortalTaskCommand,
  inviteSpeakerCommand,
  remindMissingCommand,
  revokeSpeakerAccessCommand,
} from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * The organizer's side of the speaker portal (M5.3a): portal invitations, approving proposed
 * changes, and the task board. Every write is a program command (`events:write`, the `speakers`
 * module); viewers get `forbidden` even from a stale page.
 */
const base = (org: string, event: string) => `/o/${org}/e/${event}/speakers`;
const done = (org: string, event: string) => {
  revalidatePath(base(org, event));
  revalidatePath(`${base(org, event)}/changes`);
  revalidatePath(`${base(org, event)}/tasks`);
};

export async function inviteSpeakerAction(
  org: string,
  event: string,
  speakerId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      inviteSpeakerCommand,
      { eventId: ev.id, speakerId, email: String(form.get('email') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function revokeSpeakerAccessAction(
  org: string,
  event: string,
  accountId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(revokeSpeakerAccessCommand, { eventId: ev.id, accountId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function decideChangeAction(
  org: string,
  event: string,
  changeId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const decision = form.get('decision') === 'approve' ? 'approve' : 'reject';
  try {
    await executeCommand(
      decideSpeakerChangeCommand,
      { eventId: ev.id, changeId, decision, note: textOrNull(form, 'note') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  // An approved photo becomes the speaker photo now (the worker is the backstop).
  if (decision === 'approve') await catchUpSpeakerPhotos(data.org.id);
  done(org, event);
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  return success();
}

export async function createTaskAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const due = String(form.get('dueAt') ?? '');
  const kind = String(form.get('kind') ?? 'upload');
  try {
    await executeCommand(
      createPortalTaskCommand,
      {
        eventId: ev.id,
        kind: kind as 'upload' | 'agreement' | 'confirm',
        title: String(form.get('title') ?? ''),
        instructions: String(form.get('instructions') ?? ''),
        agreementText: kind === 'agreement' ? textOrNull(form, 'agreementText') : null,
        // A wall-clock time in the event's zone (CLAUDE.md → Time); empty is rejected.
        dueAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)
          ? zonedTimeToUtc(due, ev.timezone)
          : new Date(Number.NaN),
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

export type RemindState = ProgramFormState & { readonly recipients?: number; readonly unreachable?: number };

export async function remindMissingAction(
  org: string,
  event: string,
  taskId: string,
  _prev: RemindState,
): Promise<RemindState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    const r = await executeCommand(remindMissingCommand, { eventId: ev.id, taskId }, data.ctx, ports);
    done(org, event);
    return { ...success(), recipients: r.recipients, unreachable: r.unreachable };
  } catch (err) {
    return failure(err);
  }
}

export async function assignNewSpeakersAction(
  org: string,
  event: string,
  taskId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(assignNewSpeakersCommand, { eventId: ev.id, taskId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function deleteTaskAction(
  org: string,
  event: string,
  taskId: string,
  _prev: ProgramFormState,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(deletePortalTaskCommand, { eventId: ev.id, taskId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}
