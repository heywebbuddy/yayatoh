'use server';

import {
  createRsvpLinksCommand,
  markRsvpSentCommand,
  reopenRsvpCommand,
  resetRsvpLinkCommand,
  resetRsvpPinCommand,
  setRsvpSettingsCommand,
} from '@yayatoh/guests';
import { DomainError, executeCommand, zonedTimeToUtc } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * RSVP host tools (M4.1d). Every write goes through a guests command (`guests:write`), so a
 * viewer posting a form is refused by the server, not only by the missing control.
 */
type State = ProgramFormState;

function done(org: string, event: string) {
  revalidatePath(`/o/${org}/e/${event}/guests`);
  revalidatePath(`/o/${org}/e/${event}/guests/rsvp`, 'layout');
}

async function run(
  org: string,
  event: string,
  write: (
    ev: { id: string; timezone: string },
    ctx: Parameters<typeof executeCommand>[2],
  ) => Promise<unknown>,
): Promise<State> {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  try {
    await write(ev, data.ctx);
  } catch (err) {
    return failure(err);
  }
  done(org, event);
  return success();
}

/** The deadline is typed as a wall-clock time in the event's zone (CLAUDE.md → Time). */
export async function saveRsvpSettingsAction(org: string, event: string, _prev: State, form: FormData) {
  const raw = String(form.get('deadline') ?? '').trim();
  return run(org, event, async (ev, ctx) => {
    let deadline: Date | null = null;
    if (raw) {
      try {
        deadline = zonedTimeToUtc(raw, ev.timezone);
      } catch {
        throw new DomainError('validation_failed', 'Invalid input', { field: 'deadline' });
      }
    }
    return executeCommand(
      setRsvpSettingsCommand,
      { eventId: ev.id, deadline, nameLookup: form.get('nameLookup') === '1' },
      ctx,
      ports,
    );
  });
}

/** Links and PINs for every party without one, or for one party. */
export async function createRsvpLinksAction(
  org: string,
  event: string,
  partyId: string | null,
  _prev: State,
  _form: FormData,
) {
  return run(org, event, (ev, ctx) =>
    executeCommand(
      createRsvpLinksCommand,
      { eventId: ev.id, ...(partyId ? { partyIds: [partyId] } : {}) },
      ctx,
      ports,
    ),
  );
}

const partyAction =
  (command: typeof resetRsvpPinCommand) =>
  async (org: string, event: string, partyId: string, _prev: State, _form: FormData) =>
    run(org, event, (ev, ctx) => executeCommand(command, { eventId: ev.id, partyId }, ctx, ports));

export async function resetRsvpPinAction(
  org: string,
  event: string,
  partyId: string,
  prev: State,
  form: FormData,
) {
  return partyAction(resetRsvpPinCommand)(org, event, partyId, prev, form);
}
export async function resetRsvpLinkAction(
  org: string,
  event: string,
  partyId: string,
  prev: State,
  form: FormData,
) {
  return partyAction(resetRsvpLinkCommand)(org, event, partyId, prev, form);
}
export async function markRsvpSentAction(
  org: string,
  event: string,
  partyId: string,
  prev: State,
  form: FormData,
) {
  return partyAction(markRsvpSentCommand)(org, event, partyId, prev, form);
}
export async function reopenRsvpAction(
  org: string,
  event: string,
  partyId: string,
  prev: State,
  form: FormData,
) {
  return partyAction(reopenRsvpCommand)(org, event, partyId, prev, form);
}
