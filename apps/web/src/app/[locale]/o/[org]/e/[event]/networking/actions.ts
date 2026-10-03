'use server';

import {
  addMeetingSlotsCommand,
  deleteMeetingLocationCommand,
  deleteMeetingSlotCommand,
  resolveReportCommand,
  restoreProfileCommand,
  saveMeetingLocationCommand,
  updateNetworkSettingsCommand,
} from '@yayatoh/engagement';
import { executeCommand, zonedTimeToUtc } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, numberOrNull, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * Networking console actions (M5.8a). The org and event come from the route; the commands check
 * the role (`events:write`).
 */
const path = (org: string, event: string) => `/o/${org}/e/${event}/networking`;

/** A wall-clock `datetime-local` value in the event's zone → an instant (CLAUDE.md → Time). */
function instant(v: FormDataEntryValue | null, timeZone: string): Date | null {
  try {
    return v ? zonedTimeToUtc(String(v).trim(), timeZone) : null;
  } catch {
    return null;
  }
}

async function run(
  org: string,
  event: string,
  fn: (eventId: string, ctx: Awaited<ReturnType<typeof loadEvent>>['data']['ctx']) => Promise<unknown>,
) {
  const { data, event: ev } = await loadEvent(org, event, 'sessions');
  try {
    await fn(ev.id, data.ctx);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(path(org, event));
  return success();
}

export async function settingsAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const on = form.getAll('switches').map(String);
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      updateNetworkSettingsCommand,
      {
        eventId,
        enabled: on.includes('enabled'),
        meetingsEnabled: on.includes('meetings'),
        // M5.8b: chat between connections and meeting parties, and booth chat.
        chatEnabled: on.includes('chat'),
      },
      ctx,
      ports,
    ),
  );
}

/** "Turn on networking" (a plain form: works before any script loads). */
export async function enableAction(org: string, event: string): Promise<void> {
  await run(org, event, (eventId, ctx) =>
    executeCommand(
      updateNetworkSettingsCommand,
      { eventId, enabled: true, meetingsEnabled: true },
      ctx,
      ports,
    ),
  );
}

export async function saveLocationAction(
  org: string,
  event: string,
  locationId: string | null,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const name = String(form.get('name') ?? '').trim();
  const capacity = numberOrNull(form, 'capacity');
  const bad = [...(name ? [] : ['name']), ...(capacity === null ? ['capacity'] : [])];
  if (bad.length) return { ok: false, code: 'validation_failed', fields: bad };
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      saveMeetingLocationCommand,
      {
        eventId,
        ...(locationId ? { locationId } : {}),
        name,
        kind: String(form.get('kind') ?? 'meeting_point'),
        capacity,
      },
      ctx,
      ports,
    ),
  );
}

export async function deleteLocationAction(
  org: string,
  event: string,
  locationId: string,
  _prev: FormState,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(deleteMeetingLocationCommand, { eventId, locationId }, ctx, ports),
  );
}

export async function addSlotsAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { event: ev } = await loadEvent(org, event, 'sessions');
  const from = instant(form.get('startsAt'), ev.timezone);
  const to = instant(form.get('endsAt'), ev.timezone);
  const minutes = numberOrNull(form, 'minutes');
  const bad = [
    ...(from ? [] : ['startsAt']),
    ...(to ? [] : ['endsAt']),
    ...(minutes === null ? ['minutes'] : []),
  ];
  if (bad.length || !from || !to) return { ok: false, code: 'validation_failed', fields: bad };
  return run(org, event, (eventId, ctx) =>
    executeCommand(
      addMeetingSlotsCommand,
      {
        eventId,
        startsAt: from,
        endsAt: to,
        minutes,
      },
      ctx,
      ports,
    ),
  );
}

export async function deleteSlotAction(
  org: string,
  event: string,
  slotId: string,
  _prev: FormState,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(deleteMeetingSlotCommand, { eventId, slotId }, ctx, ports),
  );
}

export async function resolveReportAction(
  org: string,
  event: string,
  reportId: string,
  action: 'hide' | 'dismiss',
  _prev: FormState,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(resolveReportCommand, { eventId, reportId, action }, ctx, ports),
  );
}

export async function restoreAction(
  org: string,
  event: string,
  profileId: string,
  _prev: FormState,
): Promise<FormState> {
  return run(org, event, (eventId, ctx) =>
    executeCommand(restoreProfileCommand, { eventId, profileId }, ctx, ports),
  );
}
