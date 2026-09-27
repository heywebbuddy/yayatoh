'use server';

import { quickLayout } from '@yayatoh/floorplan';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  assignSeatCategoryCommand,
  assignSeatsCommand,
  publishEventLayoutCommand,
  saveLayoutCommand,
  setEventLayoutCommand,
  setFinderSettingsCommand,
  unassignSeatsCommand,
} from '@yayatoh/seating';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface SeatingState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  /** Layout problems (duplicate labels, seats outside the room…), for the editor to point at. */
  readonly problems?: readonly { code: string; id: string }[];
}

const fail = (err: unknown): SeatingState => {
  if (!isDomainError(err)) return { ok: false, code: 'internal' };
  const d = (err.details ?? {}) as { reason?: unknown; problems?: unknown };
  return {
    ok: false,
    code: err.code,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    problems: Array.isArray(d.problems) ? (d.problems as { code: string; id: string }[]) : undefined,
  };
};
const int = (form: FormData, key: string, max: number) =>
  Math.max(0, Math.min(max, Math.trunc(Number(form.get(key) ?? 0) || 0)));

/** Start from numbers: a stage, rows of seats, round tables (the template picker). */
export async function quickBuildAction(
  org: string,
  event: string,
  _prev: SeatingState,
  form: FormData,
): Promise<SeatingState> {
  const { data, event: ev } = await loadEvent(org, event);
  const doc = quickLayout({
    rows: int(form, 'rows', 100),
    seatsPerRow: int(form, 'seatsPerRow', 200),
    tables: int(form, 'tables', 300),
    seatsPerTable: int(form, 'seatsPerTable', 20),
    stage: form.get('stage') === 'on',
  });
  if (doc.items.every((i) => i.kind === 'object'))
    return { ok: false, code: 'validation_failed', reason: 'no_seats' };
  try {
    await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/seating`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

/** Use a saved floor plan for this event. */
export async function useLayoutAction(
  org: string,
  event: string,
  _prev: SeatingState,
  form: FormData,
): Promise<SeatingState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      setEventLayoutCommand,
      { eventId: ev.id, layoutId: String(form.get('layoutId') ?? '') },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

/** The editor's autosave: the whole document, validated by the command. */
export async function saveDocAction(org: string, event: string, doc: unknown): Promise<SeatingState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, data.ctx, ports);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

/** Keep this plan for other events (a reusable venue room). */
export async function saveTemplateAction(
  org: string,
  event: string,
  doc: unknown,
  _prev: SeatingState,
  form: FormData,
): Promise<SeatingState> {
  const { data } = await loadEvent(org, event);
  try {
    await executeCommand(saveLayoutCommand, { name: String(form.get('name') ?? ''), doc }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/seating`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

export async function publishSeatingAction(org: string, event: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event);
  await executeCommand(publishEventLayoutCommand, { eventId: ev.id }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/seating`);
}

/** Price a row or table: its seats sell as this ticket type (or come off sale). */
export async function categoryAction(
  org: string,
  event: string,
  _prev: SeatingState,
  form: FormData,
): Promise<SeatingState> {
  const { data, event: ev } = await loadEvent(org, event);
  const ticketTypeId = String(form.get('ticketTypeId') ?? '');
  try {
    await executeCommand(
      assignSeatCategoryCommand,
      { eventId: ev.id, itemIds: form.getAll('itemId').map(String), ticketTypeId: ticketTypeId || null },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

export interface AssignState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  /** A group that didn't fit: how many were asked for and how many would. */
  readonly fits?: number;
  readonly asked?: number;
  readonly count?: number;
}

const assignFail = (err: unknown): AssignState => {
  if (!isDomainError(err)) return { ok: false, code: 'internal' };
  const d = (err.details ?? {}) as { reason?: unknown; fits?: unknown; asked?: unknown };
  return {
    ok: false,
    code: err.code,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    fits: typeof d.fits === 'number' ? d.fits : undefined,
    asked: typeof d.asked === 'number' ? d.asked : undefined,
  };
};

/** Seat people at a table or row (M1.7d): the list's "Seat them" and a drop on the plan. */
export async function assignSeatsAction(
  org: string,
  event: string,
  input: { attendeeIds: readonly string[]; itemId: string; seatUuid?: string | null },
): Promise<AssignState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    const r = await executeCommand(
      assignSeatsCommand,
      {
        eventId: ev.id,
        attendeeIds: [...input.attendeeIds],
        itemId: input.itemId,
        seatUuid: input.seatUuid || undefined,
      },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating/assign`);
    return { ok: true, code: null, count: r.seated.length };
  } catch (err) {
    return assignFail(err);
  }
}

/** Take someone off their seat; they go back to the unseated queue. */
export async function unassignSeatAction(
  org: string,
  event: string,
  attendeeId: string,
): Promise<AssignState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    const r = await executeCommand(
      unassignSeatsCommand,
      { eventId: ev.id, attendeeIds: [attendeeId] },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating/assign`);
    return { ok: true, code: null, count: r.released };
  } catch (err) {
    return assignFail(err);
  }
}

/** Seat finder (M1.7e): open it to guests or not, and how they look up their seat. */
export async function finderSettingsAction(
  org: string,
  event: string,
  _prev: SeatingState,
  form: FormData,
): Promise<SeatingState> {
  const { data, event: ev } = await loadEvent(org, event);
  try {
    await executeCommand(
      setFinderSettingsCommand,
      {
        eventId: ev.id,
        publicMap: form.get('publicMap') === 'on',
        mode: form.get('mode') === 'name' ? 'name' : 'code',
      },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating/finder`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}
