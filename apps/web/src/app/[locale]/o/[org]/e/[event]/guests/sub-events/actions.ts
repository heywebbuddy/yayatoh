'use server';

import {
  createSubEventCommand,
  type InviteTarget,
  moveSubEventCommand,
  recordSubEventResponseCommand,
  removeSubEventCommand,
  setInvitationsCommand,
  updateSubEventCommand,
} from '@yayatoh/guests';
import { executeCommand, zonedTimeToUtc } from '@yayatoh/kernel';
import { giveSubEventOwnChartCommand, removeSubEventChartCommand } from '@yayatoh/seating';
import { revalidatePath } from 'next/cache';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { loadEvent } from '@/server/console.ts';
import { failure, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * Sub-events and invitations (M4.1c) actions. Every write is a guests (or seating) command, so a
 * viewer's submission is refused by the server, not only by the missing control.
 */
type State = ProgramFormState;
type Ctx = Parameters<typeof executeCommand>[2];

const done = (org: string, event: string) => {
  revalidatePath(`/o/${org}/e/${event}/guests/sub-events`);
  revalidatePath(`/o/${org}/e/${event}/guests`);
};
const text = (form: FormData, key: string) => String(form.get(key) ?? '');
const source = (form: FormData) => (form.get('source') === 'paper' ? 'paper' : 'manual');

class FieldError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(fields.join(','));
  }
}

/** A wall-clock `datetime-local` value in the event's zone → an instant (CLAUDE.md → Time). */
function instant(form: FormData, key: string, timeZone: string): Date | null {
  const v = text(form, key).trim();
  if (!v) return null;
  try {
    return zonedTimeToUtc(v, timeZone);
  } catch {
    return null;
  }
}

/** The form's sub-event fields; every missing or unreadable one is reported at once. */
function subEventInput(form: FormData, timeZone: string) {
  const name = text(form, 'name');
  const startsAt = instant(form, 'startsAt', timeZone);
  const endsAt = instant(form, 'endsAt', timeZone);
  const bad = [
    ...(name.trim() ? [] : ['name']),
    ...(startsAt ? [] : ['startsAt']),
    ...(endsAt ? [] : ['endsAt']),
  ];
  if (bad.length || !startsAt || !endsAt) throw new FieldError(bad);
  return {
    name,
    kind: text(form, 'kind') || 'custom',
    startsAt,
    endsAt,
    place: textOrNull(form, 'place'),
    venueId: textOrNull(form, 'venueId'),
    occurrenceId: textOrNull(form, 'occurrenceId'),
    inviteAll: form.get('inviteAll') === '1',
  };
}

async function run(
  org: string,
  event: string,
  write: (ev: { id: string; timezone: string }, ctx: Ctx) => Promise<unknown>,
): Promise<State> {
  const { data, event: ev } = await loadEvent(org, event, 'guests');
  try {
    await write(ev, data.ctx);
  } catch (err) {
    if (err instanceof FieldError) return { ok: false, code: 'validation_failed', fields: err.fields };
    return failure(err);
  }
  done(org, event);
  return success();
}

export async function createSubEventAction(org: string, event: string, _prev: State, form: FormData) {
  return run(org, event, (ev, ctx) =>
    executeCommand(
      createSubEventCommand,
      { eventId: ev.id, ...subEventInput(form, ev.timezone) },
      ctx,
      ports,
    ),
  );
}

export async function updateSubEventAction(
  org: string,
  event: string,
  subEventId: string,
  _prev: State,
  form: FormData,
) {
  return run(org, event, (ev, ctx) =>
    executeCommand(
      updateSubEventCommand,
      { eventId: ev.id, subEventId, ...subEventInput(form, ev.timezone) },
      ctx,
      ports,
    ),
  );
}

export async function moveSubEventAction(
  org: string,
  event: string,
  subEventId: string,
  direction: 'up' | 'down',
  _prev: State,
  _form: FormData,
) {
  return run(org, event, (ev, ctx) =>
    executeCommand(moveSubEventCommand, { eventId: ev.id, subEventId, direction }, ctx, ports),
  );
}

export async function removeSubEventAction(
  org: string,
  event: string,
  subEventId: string,
  _prev: State,
  form: FormData,
) {
  return run(org, event, (ev, ctx) =>
    executeCommand(
      removeSubEventCommand,
      { eventId: ev.id, subEventId, confirm: form.get('confirm') === '1' },
      ctx,
      ports,
    ),
  );
}

/** The bulk bar: invite or uninvite the guests the current filters show, to one sub-event. */
export async function bulkInvitationAction(
  org: string,
  event: string,
  filter: { side: string | null; tag: string | null; vip: boolean | null },
  _prev: State,
  form: FormData,
) {
  const subEventId = text(form, 'subEventId');
  if (!subEventId) return { ok: false, code: 'validation_failed', fields: ['subEventId'] } as State;
  const filtered = filter.side || filter.tag || filter.vip !== null;
  const target: InviteTarget = filtered ? { kind: 'filter', ...filter } : { kind: 'all' };
  return run(org, event, (ev, ctx) =>
    executeCommand(
      setInvitationsCommand,
      { eventId: ev.id, subEventIds: [subEventId], target, invited: text(form, 'change') !== 'uninvite' },
      ctx,
      ports,
    ),
  );
}

/** One grid change (a cell, a whole party or a whole sub-event), from the matrix. */
export async function toggleInvitationsAction(
  org: string,
  event: string,
  change: { subEventIds: string[]; target: InviteTarget; invited: boolean },
): Promise<State> {
  return run(org, event, (ev, ctx) =>
    executeCommand(setInvitationsCommand, { eventId: ev.id, ...change }, ctx, ports),
  );
}

export async function recordResponseAction(org: string, event: string, _prev: State, form: FormData) {
  const status = text(form, 'status');
  const bad = ['guestId', 'subEventId', 'status'].filter((k) => !text(form, k));
  if (bad.length) return { ok: false, code: 'validation_failed', fields: bad } as State;
  return run(org, event, (ev, ctx) =>
    executeCommand(
      recordSubEventResponseCommand,
      {
        eventId: ev.id,
        guestId: text(form, 'guestId'),
        subEventId: text(form, 'subEventId'),
        status: status === 'clear' ? null : status,
        source: source(form),
      },
      ctx,
      ports,
    ),
  );
}

export async function giveSubEventChartAction(
  org: string,
  event: string,
  subEventId: string,
  occurrenceId: string | null,
  _prev: State,
  form: FormData,
) {
  const layoutId = textOrNull(form, 'layoutId');
  return run(org, event, (ev, ctx) =>
    executeCommand(
      giveSubEventOwnChartCommand,
      { eventId: ev.id, subEventId, occurrenceId, ...(layoutId ? { layoutId } : {}) },
      ctx,
      ports,
    ),
  );
}

export async function removeSubEventChartAction(
  org: string,
  event: string,
  subEventId: string,
  _prev: State,
  _form: FormData,
) {
  return run(org, event, (ev, ctx) =>
    executeCommand(removeSubEventChartCommand, { eventId: ev.id, subEventId }, ctx, ports),
  );
}
