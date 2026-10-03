'use server';

import {
  EVENT_VISIBILITIES,
  ensureShortLinkCommand,
  setEventDetailsCommand,
  setVanityShortLinkCommand,
  updateEventCommand,
} from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state.ts';
import { loadEvent } from '@/server/console.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

export async function saveDetailsAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'details');
  const venueId = String(form.get('venueId') ?? '');
  const category = String(form.get('category') ?? '');
  const visibility = String(form.get('visibility') ?? ev.visibility);
  try {
    if (visibility !== ev.visibility && (EVENT_VISIBILITIES as readonly string[]).includes(visibility))
      await executeCommand(
        updateEventCommand,
        { eventId: ev.id, visibility: visibility as (typeof EVENT_VISIBILITIES)[number] },
        data.ctx,
        ports,
      );
    await executeCommand(
      setEventDetailsCommand,
      {
        eventId: ev.id,
        venueId: venueId || null,
        // U8: the picker submits an org category ref (platform key of an unchanged default, else id).
        orgCategory: category || null,
        attendanceMode: String(form.get('attendanceMode') ?? 'in_person'),
        // U8: one value per chosen tag (the combobox); a comma list still works without JavaScript.
        tags: form.getAll('tags').flatMap((v) => String(v).split(',')),
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  return success();
}

export async function setVanityAction(
  org: string,
  event: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { data, event: ev } = await loadEvent(org, event, 'details');
  const code = String(form.get('code') ?? '').trim();
  try {
    await executeCommand(setVanityShortLinkCommand, { eventId: ev.id, code: code || null }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}/details`);
  return success();
}

export async function ensureShortLinkAction(org: string, event: string): Promise<void> {
  const { data, event: ev } = await loadEvent(org, event, 'details');
  await executeCommand(ensureShortLinkCommand, { eventId: ev.id }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}/details`);
}
