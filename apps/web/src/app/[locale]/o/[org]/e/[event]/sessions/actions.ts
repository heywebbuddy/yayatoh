'use server';

import { draftAgenda } from '@yayatoh/ai';
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
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import type { ProgramFormState } from '@/components/program-form.tsx';
import type { AiComposeResult } from '@/lib/ai-compose.ts';
import { aiDrafter } from '@/server/ai.ts';
import { aiCall, composeArgs } from '@/server/ai-compose.ts';
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
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
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
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
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
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  await executeCommand(deleteSessionCommand, { eventId: ev.id, sessionId }, data.ctx, ports);
  done(org, event);
}

export async function createTrackAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
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
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  await executeCommand(deleteTrackCommand, { eventId: ev.id, trackId }, data.ctx, ports);
  done(org, event);
}

export async function createRoomAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
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
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  await executeCommand(deleteRoomCommand, { eventId: ev.id, roomId }, data.ctx, ports);
  done(org, event);
}

/** M6.12b: an AI-proposed session, as the panel shows and returns it (ISO instants). */
export interface AgendaProposal {
  readonly title: string;
  readonly description: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** M6.12b: propose agenda sessions with AI (a preview; nothing is added until the organizer picks). */
export async function draftAgendaAiAction(
  org: string,
  event: string,
  values: unknown,
  sessions: number,
): Promise<AiComposeResult<AgendaProposal[]>> {
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  const v = composeArgs(values);
  const count = Number.isInteger(sessions) && sessions >= 1 && sessions <= 12 ? sessions : 4;
  return aiCall({ orgId: data.org.id, userId: data.session.userId, key: `agenda:${ev.id}` }, async () => {
    const res = await draftAgenda(data.ctx, ports, aiDrafter(), {
      tone: v.tone,
      brandKitId: v.brandKitId,
      brief: v.brief,
      eventId: ev.id,
      sessions: count,
      locale: await getLocale(),
    });
    return {
      value: res.sessions.map((s) => ({
        title: s.title,
        description: s.description,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
      balance: res.balance,
    };
  });
}

const Proposals = z
  .array(
    z.object({
      title: z.string(),
      description: z.string(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
    }),
  )
  .min(1)
  .max(12);

/** M6.12b: add the proposals the organizer kept, through the normal session command. */
export async function addAiSessionsAction(
  org: string,
  event: string,
  proposals: unknown,
): Promise<ProgramFormState & { added?: number }> {
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  const p = Proposals.safeParse(proposals);
  if (!p.success) return { ok: false, code: 'validation_failed', fields: ['sessions'] };
  let added = 0;
  const warnings: string[] = [];
  try {
    for (const s of p.data) {
      const res = await executeCommand(
        createSessionCommand,
        {
          eventId: ev.id,
          title: s.title,
          description: s.description,
          startsAt: new Date(s.startsAt),
          endsAt: new Date(s.endsAt),
          occurrenceId: null,
          roomId: null,
          trackId: null,
          capacity: null,
          speakerIds: [],
        },
        data.ctx,
        ports,
      );
      added += 1;
      const program = await executeQuery(programQuery, { eventId: ev.id }, data.ctx, ports);
      warnings.push(...(await warningMessages(res.warnings, program)));
    }
  } catch (err) {
    done(org, event);
    return { ...sessionFailure(err), added };
  }
  done(org, event);
  return { ...success(), warnings, added };
}
