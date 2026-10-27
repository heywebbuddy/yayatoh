'use server';

import { addPickupPointCommand, deletePickupPointCommand, updatePickupPointCommand } from '@yayatoh/events';
import { executeCommand, isDomainError } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { loadEvent } from '@/server/console.ts';
import { syncPickupQuestion } from '@/server/pickups.ts';
import { ports } from '@/server/ports.ts';
import type { SettingsState } from '../../../(org)/settings/actions.ts';

const fields = (form: FormData) => {
  const minutes = Number(String(form.get('minutesBefore') ?? '0').trim() || '0');
  return {
    name: String(form.get('name') ?? '').trim(),
    address: String(form.get('address') ?? '').trim(),
    minutesBefore: Number.isInteger(minutes) ? minutes : -1,
  };
};

const done = (org: string, event: string) => revalidatePath(`/o/${org}/e/${event}/pickups`);

/** Add a pickup point; the checkout question follows the list. */
export async function addPickupAction(
  org: string,
  event: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { data, event: ev } = await loadEvent(org, event, 'pickups');
  try {
    await executeCommand(addPickupPointCommand, { eventId: ev.id, ...fields(form) }, data.ctx, ports);
    await syncPickupQuestion(data.ctx, ev.id);
    done(org, event);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}

export async function updatePickupAction(
  org: string,
  event: string,
  pickupId: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { data, event: ev } = await loadEvent(org, event, 'pickups');
  try {
    await executeCommand(
      updatePickupPointCommand,
      { eventId: ev.id, pickupId, ...fields(form) },
      data.ctx,
      ports,
    );
    await syncPickupQuestion(data.ctx, ev.id);
    done(org, event);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}

export async function deletePickupAction(
  org: string,
  event: string,
  pickupId: string,
  _prev: SettingsState,
  _form: FormData,
): Promise<SettingsState> {
  const { data, event: ev } = await loadEvent(org, event, 'pickups');
  try {
    await executeCommand(deletePickupPointCommand, { eventId: ev.id, pickupId }, data.ctx, ports);
    await syncPickupQuestion(data.ctx, ev.id);
    done(org, event);
    return { ok: true, code: null };
  } catch (err) {
    return { ok: false, code: isDomainError(err) ? err.code : 'internal' };
  }
}
