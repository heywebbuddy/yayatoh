'use server';

import { executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  ADMISSIONS,
  addStandardSessionTypesCommand,
  agendaQuery,
  createSessionGroupCommand,
  createSessionTypeCommand,
  deleteSessionGroupCommand,
  deleteSessionTypeCommand,
  programQuery,
  publishAgendaCommand,
  setSessionAgendaCommand,
  unpublishAgendaCommand,
} from '@yayatoh/program';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { agendaWarningMessages } from '@/server/agenda.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/** M5.2a: agenda v2 actions of the Sessions page (types, groups, per-session fields, publishing). */

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/sessions`);

export async function publishAgendaAction(org: string, event: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(publishAgendaCommand, { eventId: ev.id }, data.ctx, ports);
  done(org, event);
}

export async function unpublishAgendaAction(org: string, event: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(unpublishAgendaCommand, { eventId: ev.id }, data.ctx, ports);
  done(org, event);
}

export async function createSessionTypeAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      createSessionTypeCommand,
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

/** The standard types, named in the organizer's language. */
export async function addStandardTypesAction(org: string, event: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  const t = await getTranslations('agenda.types.standard');
  const names = (['keynote', 'talk', 'workshop', 'panel', 'break'] as const).map((k) => t(k));
  await executeCommand(addStandardSessionTypesCommand, { eventId: ev.id, names }, data.ctx, ports);
  done(org, event);
}

export async function deleteSessionTypeAction(org: string, event: string, typeId: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(deleteSessionTypeCommand, { eventId: ev.id, typeId }, data.ctx, ports);
  done(org, event);
}

export async function createSessionGroupAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      createSessionGroupCommand,
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

export async function deleteSessionGroupAction(
  org: string,
  event: string,
  groupId: string,
  _prev: ProgramFormState,
  _form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(deleteSessionGroupCommand, { eventId: ev.id, groupId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function setSessionAgendaAction(
  org: string,
  event: string,
  sessionId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const admission = String(form.get('admission') ?? 'included');
  try {
    const res = await executeCommand(
      setSessionAgendaCommand,
      {
        eventId: ev.id,
        sessionId,
        typeId: textOrNull(form, 'typeId'),
        admission: (ADMISSIONS as readonly string[]).includes(admission)
          ? (admission as (typeof ADMISSIONS)[number])
          : 'included',
        groupId: textOrNull(form, 'groupId'),
        enrollmentOpen: String(form.get('enrollment') ?? 'open') !== 'closed',
      },
      data.ctx,
      ports,
    );
    done(org, event);
    const program = await executeQuery(programQuery, { eventId: ev.id }, data.ctx, ports);
    const agenda = await executeQuery(agendaQuery, { eventId: ev.id }, data.ctx, ports);
    return { ...success(), warnings: await agendaWarningMessages(res.warnings, program, agenda) };
  } catch (err) {
    return failure(err);
  }
}
