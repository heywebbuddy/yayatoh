'use server';

import { quickLayout } from '@yayatoh/floorplan';
import { executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  allocateGroupSeatsCommand,
  assignSeatCategoryCommand,
  assignSeatsCommand,
  giveDateOwnChartCommand,
  MAX_COMPANION_SEATS,
  MAX_COMPANIONS_PER_ACCESSIBLE,
  MAX_GROUP_SEATS,
  MAX_RELEASE_DAYS,
  MAX_SEATS_PER_ORDER,
  MAX_SECTION_SCORE,
  publishEventLayoutCommand,
  releaseGroupSeatsCommand,
  removeDateChartCommand,
  type SeatingRuleDto,
  saveLayoutCommand,
  seatAssignBulk,
  seatingRulesQuery,
  setCompanionSeatsCommand,
  setEventLayoutCommand,
  setFinderSettingsCommand,
  setSeatingRulesCommand,
  setSelectionSettingsCommand,
  unassignSeatsCommand,
} from '@yayatoh/seating';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { runBulkInline } from '@/server/bulk.ts';
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
/** A date id from a form or the page (M1.7g): anything else is the event plan. */
const dateOf = (v: unknown): string | null =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
    ? v
    : null;
const int = (form: FormData, key: string, max: number) =>
  Math.max(0, Math.min(max, Math.trunc(Number(form.get(key) ?? 0) || 0)));

/** Start from numbers: a stage, rows of seats, round tables (the template picker). */
export async function quickBuildAction(
  org: string,
  event: string,
  _prev: SeatingState,
  form: FormData,
): Promise<SeatingState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
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
  const { data, event: ev } = await loadEvent(org, event, 'seating');
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

/** The editor's autosave: the whole document, validated by the command (the date's chart, M1.7g). */
export async function saveDocAction(
  org: string,
  event: string,
  date: string | null,
  doc: unknown,
): Promise<SeatingState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    await executeCommand(
      setEventLayoutCommand,
      { eventId: ev.id, occurrenceId: dateOf(date), doc },
      data.ctx,
      ports,
    );
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
  const { data } = await loadEvent(org, event, 'seating');
  try {
    await executeCommand(saveLayoutCommand, { name: String(form.get('name') ?? ''), doc }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/seating`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

export async function publishSeatingAction(org: string, event: string, date: string | null): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  await executeCommand(
    publishEventLayoutCommand,
    { eventId: ev.id, occurrenceId: dateOf(date) },
    data.ctx,
    ports,
  );
  revalidatePath(`/o/${org}/e/${event}/seating`);
}

/**
 * Per-date charts (M1.7g): give the chosen date its own copy of the event plan, or send it back
 * to the event plan. Errors come back as state for the page to announce.
 */
export async function dateChartAction(
  org: string,
  event: string,
  date: string,
  _prev: SeatingState,
  form: FormData,
): Promise<SeatingState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  const occurrenceId = dateOf(date);
  if (!occurrenceId) return { ok: false, code: 'validation_failed' };
  try {
    if (form.get('op') === 'remove')
      await executeCommand(removeDateChartCommand, { eventId: ev.id, occurrenceId }, data.ctx, ports);
    else await executeCommand(giveDateOwnChartCommand, { eventId: ev.id, occurrenceId }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/seating`);
    return { ok: true, code: null };
  } catch (err) {
    return fail(err);
  }
}

/** Price a row or table: its seats sell as this ticket type (or come off sale). */
export async function categoryAction(
  org: string,
  event: string,
  date: string | null,
  _prev: SeatingState,
  form: FormData,
): Promise<SeatingState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  const ticketTypeId = String(form.get('ticketTypeId') ?? '');
  try {
    await executeCommand(
      assignSeatCategoryCommand,
      {
        eventId: ev.id,
        occurrenceId: dateOf(date),
        itemIds: form.getAll('itemId').map(String),
        ticketTypeId: ticketTypeId || null,
      },
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
  date: string | null,
  input: {
    attendeeIds: readonly string[];
    itemId: string;
    seatUuid?: string | null;
    overrideRules?: boolean;
  },
): Promise<AssignState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    const r = await executeCommand(
      assignSeatsCommand,
      {
        eventId: ev.id,
        occurrenceId: dateOf(date),
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
  date: string | null,
  attendeeId: string,
): Promise<AssignState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    const r = await executeCommand(
      unassignSeatsCommand,
      { eventId: ev.id, occurrenceId: dateOf(date), attendeeIds: [attendeeId] },
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
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    await executeCommand(
      setFinderSettingsCommand,
      {
        eventId: ev.id,
        publicMap: form.get('publicMap') === 'on',
        mode: form.get('mode') === 'name' ? 'name' : form.get('mode') === 'pin' ? 'pin' : 'code',
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
  readonly field?: 'adaDays' | 'capMax' | 'companionMax';
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
  const { data, event: ev } = await loadEvent(org, event, 'seating');
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
  if (form.get('companionShown') === '1') {
    if (form.get('companion') === 'on') {
      const maxPerAccessible = num('companionMax');
      if (!(maxPerAccessible >= 1 && maxPerAccessible <= MAX_COMPANIONS_PER_ACCESSIBLE))
        return { ok: false, code: 'validation_failed', field: 'companionMax' };
      rules.push({
        kind: 'ada_companion',
        severity: severity('companionSeverity'),
        params: { maxPerAccessible },
      });
    }
  } else {
    // M6.11a: without advanced seating the form has no companion fieldset; keep the rule as is.
    const kept = (await executeQuery(seatingRulesQuery, { eventId: ev.id }, data.ctx, ports)).find(
      (r) => r.kind === 'ada_companion',
    );
    if (kept) rules.push(kept);
  }
  try {
    await executeCommand(setSeatingRulesCommand, { eventId: ev.id, rules }, data.ctx, ports);
    revalidatePath(`/o/${org}/e/${event}/seating/rules`);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}

export interface GroupState {
  readonly ok: boolean;
  readonly code: string | null;
  /** What was done: seats kept for a group, or seats released. */
  readonly done?: 'allocated' | 'released' | 'seated';
  readonly count?: number;
  readonly label?: string;
  /** The table or row (id) the seats were kept at. */
  readonly item?: string;
  /** Which field is wrong (the form points at it). */
  readonly field?: 'label' | 'itemId' | 'count';
  readonly reason?: string;
  readonly fits?: number;
  /** When the server answered (the page shows the newest of several forms' answers). */
  readonly at?: number;
}

const groupFail = (err: unknown): GroupState => {
  if (!isDomainError(err)) return { ok: false, code: 'internal' };
  const d = (err.details ?? {}) as { reason?: unknown; fits?: unknown };
  return {
    ok: false,
    code: err.code,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    fits: typeof d.fits === 'number' ? d.fits : undefined,
  };
};

/** Keep a block of seats at a table or row for a group (M1.8f). */
export async function allocateGroupAction(
  org: string,
  event: string,
  date: string | null,
  _prev: GroupState,
  form: FormData,
): Promise<GroupState> {
  const label = String(form.get('label') ?? '').trim();
  const itemId = String(form.get('itemId') ?? '');
  const rawCount = String(form.get('count') ?? '').trim();
  if (!label || label.length > 40) return { ok: false, code: 'validation_failed', field: 'label' };
  if (!itemId) return { ok: false, code: 'validation_failed', field: 'itemId' };
  const count = rawCount ? Number(rawCount) : undefined;
  if (count !== undefined && !(Number.isInteger(count) && count >= 1 && count <= MAX_GROUP_SEATS))
    return { ok: false, code: 'validation_failed', field: 'count' };
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    const r = await executeCommand(
      allocateGroupSeatsCommand,
      { eventId: ev.id, occurrenceId: dateOf(date), label, itemId, count },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating/assign`);
    return { ok: true, code: null, done: 'allocated', count: r.allocated, label: r.label, item: itemId };
  } catch (err) {
    return groupFail(err);
  }
}

/** Give a group's unused seats back to sale. */
export async function releaseGroupAction(
  org: string,
  event: string,
  date: string | null,
  _prev: GroupState,
  form: FormData,
): Promise<GroupState> {
  const label = String(form.get('label') ?? '');
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  try {
    const r = await executeCommand(
      releaseGroupSeatsCommand,
      { eventId: ev.id, occurrenceId: dateOf(date), label },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating/assign`);
    return { ok: true, code: null, done: 'released', count: r.released, label, at: Date.now() };
  } catch (err) {
    return { ...groupFail(err), label, at: Date.now() };
  }
}

/**
 * Seat everyone labelled with the group's name into its block (a bulk operation, M1.8f), then
 * show its progress on the attendee list, filtered to the group.
 */
export async function seatGroupAction(
  org: string,
  event: string,
  date: string | null,
  _prev: GroupState,
  form: FormData,
): Promise<GroupState> {
  const label = String(form.get('label') ?? '');
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  let operationId: string;
  try {
    ({ operationId } = await executeCommand(
      seatAssignBulk.start,
      {
        eventId: ev.id,
        selection: { filter: { labels: [label], status: 'active' } },
        params: { target: { kind: 'group', label }, occurrenceId: dateOf(date) },
      },
      data.ctx,
      ports,
    ));
  } catch (err) {
    return { ...groupFail(err), label, done: 'seated', at: Date.now() };
  }
  await runBulkInline(data.org.id, operationId);
  const q = new URLSearchParams({ label, op: operationId, opk: 'seats' });
  if (dateOf(date)) q.set('date', date as string);
  return redirect({ href: `/o/${org}/e/${event}/attendees?${q}`, locale: await getLocale() });
}

/** Best available settings and companion seats (M6.11a). */
export interface SelectionState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  /** The field whose value was refused (`score:{sectionId}`). */
  readonly field?: string;
  /** Companion seats saved. */
  readonly count?: number;
}

/**
 * Offer best available and score sections (M6.11a). A blank score ranks the section by its
 * distance to the stage.
 */
export async function selectionSettingsAction(
  org: string,
  event: string,
  _prev: SelectionState,
  form: FormData,
): Promise<SelectionState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  const sectionScores: Record<string, number> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('score:')) continue;
    const raw = String(value).trim();
    if (!raw) continue;
    if (!/^\d{1,3}$/.test(raw) || Number(raw) > MAX_SECTION_SCORE)
      return { ok: false, code: 'validation_failed', field: key };
    sectionScores[key.slice('score:'.length)] = Number(raw);
  }
  try {
    await executeCommand(
      setSelectionSettingsCommand,
      { eventId: ev.id, bestAvailable: form.get('bestAvailable') === 'on', sectionScores },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating/best-available`);
    return { ok: true, code: null };
  } catch (err) {
    return {
      ok: false,
      code: isDomainError(err) ? err.code : 'internal',
      ...(isDomainError(err) && err.details?.reason ? { reason: String(err.details.reason) } : {}),
    };
  }
}

/** Mark the event's companion seats (M6.11a): every ticked seat, the rest stop being companions. */
export async function companionSeatsAction(
  org: string,
  event: string,
  _prev: SelectionState,
  form: FormData,
): Promise<SelectionState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  const seatUuids = [...new Set(form.getAll('companion').map(String))].slice(0, MAX_COMPANION_SEATS);
  try {
    const { count } = await executeCommand(
      setCompanionSeatsCommand,
      { eventId: ev.id, seatUuids },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating/best-available`);
    return { ok: true, code: null, count };
  } catch (err) {
    return {
      ok: false,
      code: isDomainError(err) ? err.code : 'internal',
      ...(isDomainError(err) && err.details?.reason ? { reason: String(err.details.reason) } : {}),
    };
  }
}
