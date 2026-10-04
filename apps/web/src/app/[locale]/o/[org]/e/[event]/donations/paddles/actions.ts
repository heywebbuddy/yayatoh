'use server';

import { assignPaddleCommand, bulkAssignPaddlesCommand, releasePaddleCommand } from '@yayatoh/donations';
import { DomainError, executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/donations/paddles`);

/** `guest:<id>` or `party:<id>` from the holder select. */
function holder(form: FormData): { guestId?: string; partyId?: string } {
  const [kind, id] = String(form.get('holder') ?? '').split(':');
  if (kind === 'guest' && id) return { guestId: id };
  if (kind === 'party' && id) return { partyId: id };
  return {};
}

export async function assignPaddleAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(
      assignPaddleCommand,
      { eventId: ev.id, ...holder(form), number: numberOrNull(form, 'number') },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function bulkAssignAction(
  org: string,
  event: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    const r = await executeCommand(
      bulkAssignPaddlesCommand,
      {
        eventId: ev.id,
        scope: String(form.get('scope') ?? ''),
        per: String(form.get('per') ?? ''),
        startAt: numberOrNull(form, 'startAt'),
      },
      data.ctx,
      ports,
    );
    if (r.assigned === 0)
      throw new DomainError('invalid_state', 'Everyone has a paddle', { reason: 'nobody_left' });
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function releasePaddleAction(
  org: string,
  event: string,
  paddleId: string,
  _prev: ProgramFormState,
  _form: FormData,
): Promise<ProgramFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'donations');
  try {
    await executeCommand(releasePaddleCommand, { eventId: ev.id, paddleId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}
