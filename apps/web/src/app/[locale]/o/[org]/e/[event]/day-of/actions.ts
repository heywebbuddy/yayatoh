'use server';

import {
  enrollDeviceCommand,
  markGuestsArrivedCommand,
  startKioskCommand,
  stopKioskCommand,
  undoGuestArrivalCommand,
} from '@yayatoh/checkin';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { EnrollState } from '@/app/[locale]/o/[org]/e/[event]/onsite/actions.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** What a day-of form shows after its action: done, or why not (a field for inline errors). */
export type DayOfState = {
  readonly ok: boolean;
  readonly code: string | null;
  readonly field?: string | null;
};

const fail = (err: unknown): DayOfState => {
  if (!isDomainError(err)) throw err;
  const field = (err.details as { field?: unknown } | undefined)?.field;
  return { ok: false, code: err.code, field: typeof field === 'string' ? field : null };
};

const path = (org: string, event: string) => `/o/${org}/e/${event}/day-of`;

/** The host checks a guest in from the day-of page (M4.4b). */
export async function markArrivedAction(
  org: string,
  event: string,
  guestId: string,
  _prev: DayOfState,
  _form: FormData,
): Promise<DayOfState> {
  const { data, event: ev } = await loadEvent(org, event, 'dayOf');
  try {
    await executeCommand(markGuestsArrivedCommand, { eventId: ev.id, guestIds: [guestId] }, data.ctx, ports);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(path(org, event));
  return { ok: true, code: null };
}

/** Undo a mistaken check-in. */
export async function undoArrivalAction(
  org: string,
  event: string,
  guestId: string,
  _prev: DayOfState,
  _form: FormData,
): Promise<DayOfState> {
  const { data, event: ev } = await loadEvent(org, event, 'dayOf');
  try {
    await executeCommand(undoGuestArrivalCommand, { eventId: ev.id, guestId }, data.ctx, ports);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(path(org, event));
  return { ok: true, code: null };
}

/** Add a device (a tablet for the guest kiosk, a TV for the board) from the day-of page. */
export async function enrollDayOfDeviceAction(
  org: string,
  event: string,
  _prev: EnrollState,
  form: FormData,
): Promise<EnrollState> {
  const { data } = await loadEvent(org, event, 'dayOf');
  const label = String(form.get('label') ?? '').trim();
  try {
    const r = await executeCommand(enrollDeviceCommand, { label, assignedUserId: null }, data.ctx, ports);
    revalidatePath(path(org, event));
    return { kind: 'enrolled', label, token: r.token };
  } catch (err) {
    return { kind: 'error', code: isDomainError(err) ? err.code : 'internal' };
  }
}

/** Make a device the guest kiosk or the A–Z table board, with a staff PIN to leave it. */
export async function startKioskAction(
  org: string,
  event: string,
  deviceId: string,
  _prev: DayOfState,
  form: FormData,
): Promise<DayOfState> {
  const { data, event: ev } = await loadEvent(org, event, 'dayOf');
  const kind = form.get('kind') === 'board' ? 'board' : 'guests';
  const pin = String(form.get('pin') ?? '').trim();
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, code: 'validation_failed', field: 'pin' };
  try {
    await executeCommand(
      startKioskCommand,
      { eventId: ev.id, deviceId, checkpointId: null, pin, kind },
      data.ctx,
      ports,
    );
  } catch (err) {
    return fail(err);
  }
  revalidatePath(path(org, event));
  return { ok: true, code: null };
}

export async function stopKioskAction(
  org: string,
  event: string,
  deviceId: string,
  _prev: DayOfState,
  _form: FormData,
): Promise<DayOfState> {
  const { data, event: ev } = await loadEvent(org, event, 'dayOf');
  try {
    await executeCommand(stopKioskCommand, { eventId: ev.id, deviceId }, data.ctx, ports);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(path(org, event));
  return { ok: true, code: null };
}
