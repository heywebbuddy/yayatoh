'use server';

import { quickLayout } from '@yayatoh/floorplan';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  assignSeatCategoryCommand,
  assignSeatsCommand,
  MAX_RELEASE_DAYS,
  MAX_SEATS_PER_ORDER,
  publishEventLayoutCommand,
  type SeatingRuleDto,
  saveLayoutCommand,
  setEventLayoutCommand,
  setFinderSettingsCommand,
  setSeatingRulesCommand,
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
  /** The table or row they were seated at, and the seats (labels). */
  readonly itemLabel?: string;
  /** A seating rule that refused the seat (M1.7f), and whether staff may override it. */
  readonly rule?: string;
  readonly overridable?: boolean;
  /** Seating rules that warned: kept-back accessible seats used (labels), until when. */
  readonly adaWarning?: { readonly seats: readonly string[]; readonly releaseAt: string } | null;
}

const assignFail = (err: unknown): AssignState => {
  if (!isDomainError(err)) return { ok: false, code: 'internal' };
  const d = (err.details ?? {}) as {
    reason?: unknown;
    fits?: unknown;
    asked?: unknown;
    rule?: unknown;
    overridable?: unknown;
  };
  return {
    ok: false,
    code: err.code,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    fits: typeof d.fits === 'number' ? d.fits : undefined,
    asked: typeof d.asked === 'number' ? d.asked : undefined,
    rule: typeof d.rule === 'string' ? d.rule : undefined,
    overridable: d.overridable === true,
  };
};

/**
 * Seat people at a table or row (M1.7d): the list's "Seat them", a drop on the plan, and moving
 * someone already seated ("Move to…", or dragging them; M1.7f). `overrideRules`: the organizer
 * confirmed the guest needs a kept-back accessible seat.
 */
export async function assignSeatsAction(
  org: string,
  event: string,
  input: {
    attendeeIds: readonly string[];
    itemId: string;
    seatUuid?: string | null;
    overrideRules?: boolean;
  },
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
        overrideRules: input.overrideRules === true,
      },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating/assign`);
    const labelOf = new Map(r.seated.map((x) => [x.seatUuid, x.seatLabel]));
    const ada = r.warnings.find((w) => w.rule === 'ada_reserved');
    return {
      ok: true,
      code: null,
      count: r.seated.length,
      itemLabel: r.itemLabel,
      adaWarning:
        ada && ada.rule === 'ada_reserved'
          ? { seats: ada.seats.map((s) => labelOf.get(s) ?? ''), releaseAt: ada.releaseAt.toISOString() }
          : null,
    };
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

export interface RulesState {
  readonly ok: boolean;
  readonly code: string | null;
  /** The field whose value was refused. */
  readonly field?: 'adaDays' | 'capMax';
}

/**
 * Seating rules (M1.7f): keep accessible seats back until some days before the event, and cap
 * the seats in one order; each warns (the default, decision D18) or is enforced.
 */
export async function seatingRulesAction(
  org: string,
  event: string,
  _prev: RulesState,
  form: FormData,
): Promise<RulesState> {
  const { data, event: ev } = await loadEvent(org, event);
  const num = (key: string) => {
    const raw = String(form.get(key) ?? '').trim();
    return /^\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
  };
  const severity = (key: string) => (form.get(key) === 'enforce' ? ('enforce' as const) : ('warn' as const));
  const rules: SeatingRuleDto[] = [];
  if (form.get('ada') === 'on') {
    const releaseDays = num('adaDays');
    if (!(releaseDays >= 0 && releaseDays <= MAX_RELEASE_DAYS))
      return { ok: false, code: 'validation_failed', field: 'adaDays' };
    rules.push({ kind: 'ada_reserved', severity: severity('adaSeverity'), params: { releaseDays } });
  }
  if (form.get('cap') === 'on') {
    const max = num('capMax');
    if (!(max >= 1 && max <= MAX_SEATS_PER_ORDER))
      return { ok: false, code: 'validation_failed', field: 'capMax' };
    rules.push({ kind: 'max_per_order_seats', severity: severity('capSeverity'), params: { max } });
  }
  try {
    await executeCommand(setSeatingRulesCommand, { eventId: ev.id, rules }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/seating/rules`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}
