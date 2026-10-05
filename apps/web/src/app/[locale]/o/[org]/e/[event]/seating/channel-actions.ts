'use server';

import { executeCommand, executeQuery, isDomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import {
  allotSeatsCommand,
  CHANNEL_KINDS,
  deleteSeatChannelCommand,
  eventSeatingQuery,
  restoreLayoutRevisionCommand,
  saveSeatChannelCommand,
  seatNumberList,
} from '@yayatoh/seating';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ChannelFormState {
  readonly ok: boolean;
  readonly code: string | null;
  /** The field whose value was refused, and why (the command's reason). */
  readonly field?: 'kind' | 'name' | 'code' | 'releaseAt';
  readonly reason?: string;
}

/**
 * Sales channels (M6.11b): create or change one. The release time is typed as wall-clock time in
 * the event's time zone (CLAUDE.md → Time).
 */
export async function saveChannelAction(
  org: string,
  event: string,
  id: string | null,
  _prev: ChannelFormState,
  form: FormData,
): Promise<ChannelFormState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const kind = get('kind');
  if (!(CHANNEL_KINDS as readonly string[]).includes(kind))
    return { ok: false, code: 'validation_failed', field: 'kind' };
  const name = get('name');
  if (!name || name.length > 80) return { ok: false, code: 'validation_failed', field: 'name' };
  let releaseAt: Date | null = null;
  if (get('releaseAt')) {
    try {
      releaseAt = zonedTimeToUtc(get('releaseAt'), ev.timezone);
    } catch {
      return { ok: false, code: 'validation_failed', field: 'releaseAt' };
    }
  }
  try {
    await executeCommand(
      saveSeatChannelCommand,
      {
        eventId: ev.id,
        ...(id && UUID.test(id) ? { id } : {}),
        kind: kind as (typeof CHANNEL_KINDS)[number],
        name,
        code: get('code') || null,
        releaseAt,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const field = err.details?.field;
    return {
      ok: false,
      code: err.code,
      ...(field === 'code' || field === 'kind' || field === 'name' ? { field } : {}),
      ...(typeof err.details?.reason === 'string' ? { reason: err.details.reason } : {}),
    };
  }
  revalidatePath(`/o/${org}/e/${event}/seating/channels`);
  // An edit goes back to the list (the form opens empty again).
  if (id)
    return redirect({ href: `/o/${org}/e/${event}/seating/channels?saved=1`, locale: await getLocale() });
  return { ok: true, code: null };
}

/** Remove a channel: its seats go back to every channel. */
export async function deleteChannelAction(org: string, event: string, id: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  await executeCommand(deleteSeatChannelCommand, { eventId: ev.id, id }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/seating/channels`);
  return redirect({ href: `/o/${org}/e/${event}/seating/channels?deleted=1`, locale: await getLocale() });
}

export interface AllotState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly field?: 'seats' | 'channel';
  /** Seats allotted (or given back). */
  readonly count?: number;
  /** Given back to every channel rather than allotted. */
  readonly freed?: boolean;
}

/**
 * Allot seats (M6.11b): the chosen rows and tables, or only the seats numbered in "Only these
 * seats", to a channel — or back to every channel. Seat ids come from the event plan.
 */
export async function allotAction(
  org: string,
  event: string,
  _prev: AllotState,
  form: FormData,
): Promise<AllotState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  const channel = String(form.get('channelId') ?? '');
  if (channel !== '' && !UUID.test(channel))
    return { ok: false, code: 'validation_failed', field: 'channel' };
  const items = new Set(form.getAll('itemId').map(String));
  if (items.size === 0) return { ok: false, code: 'validation_failed', field: 'seats' };
  const only = seatNumberList(String(form.get('seatNumbers') ?? ''));
  const plan = await executeQuery(eventSeatingQuery, { eventId: ev.id }, data.ctx, ports);
  const seatUuids = (plan?.doc.items ?? []).flatMap((i) =>
    i.kind === 'object' || !items.has(i.id)
      ? []
      : i.seats.filter((s) => only.size === 0 || only.has(s.label.toLowerCase())).map((s) => s.id),
  );
  if (seatUuids.length === 0) return { ok: false, code: 'validation_failed', field: 'seats' };
  try {
    const r = await executeCommand(
      allotSeatsCommand,
      { eventId: ev.id, channelId: channel || null, seatUuids },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/e/${event}/seating/channels`);
    return { ok: true, code: null, count: r.updated, freed: channel === '' };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { ok: false, code: err.code, ...(err.details?.field === 'channelId' ? { field: 'channel' } : {}) };
  }
}

export interface RestoreState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
}

/** Layout revisions (M6.11b): bring a revision back, then show the new one. */
export async function restoreRevisionAction(
  org: string,
  event: string,
  date: string | null,
  number: number,
  _prev: RestoreState,
  _form: FormData,
): Promise<RestoreState> {
  const { data, event: ev } = await loadEvent(org, event, 'seating');
  const occurrenceId = date && UUID.test(date) ? date : null;
  let restored: number;
  try {
    restored = (
      await executeCommand(
        restoreLayoutRevisionCommand,
        { eventId: ev.id, occurrenceId, number },
        data.ctx,
        ports,
      )
    ).number;
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return {
      ok: false,
      code: err.code,
      ...(typeof err.details?.reason === 'string' ? { reason: err.details.reason } : {}),
    };
  }
  revalidatePath(`/o/${org}/e/${event}/seating`);
  const q = new URLSearchParams({ rev: String(restored), restored: String(number) });
  if (occurrenceId) q.set('date', occurrenceId);
  return redirect({ href: `/o/${org}/e/${event}/seating/revisions?${q}`, locale: await getLocale() });
}
