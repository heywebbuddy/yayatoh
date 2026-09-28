'use server';

import { executeCommand, executeQuery, zonedTimeToUtc } from '@yayatoh/kernel';
import {
  createRoomCommand,
  createSessionCommand,
  createTrackCommand,
  deleteRoomCommand,
  deleteSessionCommand,
  deleteTrackCommand,
  programQuery,
  type SessionResultDto,
  updateSessionCommand,
} from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { warningMessages } from '@/server/program.ts';

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/sessions`);

class FieldError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(fields.join(','));
  }
}

/** A wall-clock `datetime-local` value in the event's zone → an instant (CLAUDE.md → Time). */
function instant(form: FormData, key: string, timeZone: string): Date | null {
  const v = String(form.get(key) ?? '').trim();
  if (!v) return null;
  try {
    return zonedTimeToUtc(v, timeZone);
  } catch {
    return null;
  }
}

/** The form's session fields; every missing or unreadable one is reported at once. */
function sessionInput(form: FormData, timeZone: string) {
  const title = String(form.get('title') ?? '');
  const startsAt = instant(form, 'startsAt', timeZone);
  const endsAt = instant(form, 'endsAt', timeZone);
  const bad = [
    ...(title.trim() ? [] : ['title']),
    ...(startsAt ? [] : ['startsAt']),
    ...(endsAt ? [] : ['endsAt']),
  ];
  if (bad.length || !startsAt || !endsAt) throw new FieldError(bad);
  return {
    title,
    description: String(form.get('description') ?? ''),
    startsAt,
    endsAt,
    occurrenceId: textOrNull(form, 'occurrenceId'),
    roomId: textOrNull(form, 'roomId'),
    trackId: textOrNull(form, 'trackId'),
    capacity: numberOrNull(form, 'capacity'),
    speakerIds: form.getAll('speakerIds').map(String).filter(Boolean),
  };
}

async function saved(
  org: string,
  event: string,
  eventId: string,
  res: SessionResultDto,
  ctx: Parameters<typeof executeQuery>[2],
): Promise<ProgramFormState> {
  done(org, event);
  const program = await executeQuery(programQuery, { eventId }, ctx, ports);
  return { ...success(), warnings: await warningMessages(res.warnings, program) };
}

function sessionFailure(err: unknown): ProgramFormState {
  if (err instanceof FieldError) return { ok: false, code: 'validation_failed', fields: err.fields };
  return failure(err);
}

export async function createSessionAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    const res = await executeCommand(
      createSessionCommand,
      { eventId: ev.id, ...sessionInput(form, ev.timezone) },
      data.ctx,
      ports,
    );
    return await saved(org, event, ev.id, res, data.ctx);
  } catch (err) {
    return sessionFailure(err);
  }
}

export async function updateSessionAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    const res = await executeCommand(
      updateSessionCommand,
      { eventId: ev.id, sessionId, ...sessionInput(form, ev.timezone) },
      data.ctx,
      ports,
    );
    return await saved(org, event, ev.id, res, data.ctx);
  } catch (err) {
    return sessionFailure(err);
  }
}

export async function deleteSessionAction(org: string, event: string, sessionId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(deleteSessionCommand, { eventId: ev.id, sessionId }, data.ctx, ports);
  done(org, event);
}

export async function createTrackAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      createTrackCommand,
      { eventId: ev.id, name: String(form.get('name') ?? '') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function deleteTrackAction(org: string, event: string, trackId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(deleteTrackCommand, { eventId: ev.id, trackId }, data.ctx, ports);
  done(org, event);
}

export async function createRoomAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      createRoomCommand,
      { eventId: ev.id, name: String(form.get('name') ?? ''), capacity: numberOrNull(form, 'capacity') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function deleteRoomAction(org: string, event: string, roomId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(deleteRoomCommand, { eventId: ev.id, roomId }, data.ctx, ports);
  done(org, event);
}
