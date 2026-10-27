'use server';

import { executeCommand } from '@yayatoh/kernel';
import {
  createVenueCommand,
  setQuoteRequestStatusCommand,
  setVenueArchivedCommand,
  updateVenueCommand,
} from '@yayatoh/venues';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import type { FormState } from '@/lib/form-state.ts';
import { loadConsole } from '@/server/console.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

function venueFields(form: FormData) {
  return {
    name: String(form.get('name') ?? '').trim(),
    addressLine1: textOrNull(form, 'addressLine1'),
    addressLine2: textOrNull(form, 'addressLine2'),
    city: textOrNull(form, 'city'),
    region: textOrNull(form, 'region'),
    postalCode: textOrNull(form, 'postalCode'),
    country: String(form.get('country') ?? '').trim(),
    latitude: numberOrNull(form, 'latitude'),
    longitude: numberOrNull(form, 'longitude'),
    timezone: String(form.get('timezone') ?? '').trim(),
    capacity: numberOrNull(form, 'capacity'),
    accessibilityNotes: textOrNull(form, 'accessibilityNotes'),
    mapUrl: textOrNull(form, 'mapUrl'),
    description: textOrNull(form, 'description'),
    contactEmail: textOrNull(form, 'contactEmail'),
    contactPhone: textOrNull(form, 'contactPhone'),
    websiteUrl: textOrNull(form, 'websiteUrl'),
    directoryListed: form.get('directoryListed') === '1',
  };
}

export async function createVenueAction(org: string, _prev: FormState, form: FormData): Promise<FormState> {
  const data = await loadConsole(org);
  let id: string;
  try {
    id = (await executeCommand(createVenueCommand, venueFields(form), data.ctx, ports)).id;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/venues`);
  return redirect({ href: `/o/${org}/venues/${id}?saved=1`, locale: await getLocale() });
}

export async function updateVenueAction(
  org: string,
  venueId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(updateVenueCommand, { venueId, ...venueFields(form) }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/venues`, 'layout');
  return success();
}

export async function setVenueArchivedAction(org: string, venueId: string, archived: boolean): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(setVenueArchivedCommand, { venueId, archived }, data.ctx, ports);
  revalidatePath(`/o/${org}/venues`, 'layout');
}

export async function setQuoteStatusAction(
  org: string,
  venueId: string,
  quoteRequestId: string,
  status: 'new' | 'handled',
): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(setQuoteRequestStatusCommand, { quoteRequestId, status }, data.ctx, ports);
  revalidatePath(`/o/${org}/venues/${venueId}`);
}

export type InlineVenueResult =
  | { ok: true; venue: { id: string; name: string; city: string | null; timezone: string } }
  | { ok: false; fields: readonly string[] };

/** The event wizard's "Add a new venue": creates the saved venue and returns it to be selected. */
export async function createVenueInlineAction(
  org: string,
  input: Record<string, string>,
): Promise<InlineVenueResult> {
  const data = await loadConsole(org);
  const text = (k: string) => (input[k]?.trim() ? input[k].trim() : null);
  const capacity = input.capacity?.trim() ? Number(input.capacity) : null;
  try {
    const row = await executeCommand(
      createVenueCommand,
      {
        name: (input.name ?? '').trim(),
        addressLine1: text('addressLine1'),
        city: text('city'),
        country: (input.country ?? '').trim(),
        timezone: (input.timezone ?? '').trim(),
        capacity: capacity !== null && Number.isFinite(capacity) ? capacity : null,
        contactEmail: text('contactEmail'),
        contactPhone: text('contactPhone'),
        websiteUrl: text('websiteUrl'),
      },
      data.ctx,
      ports,
    );
    revalidatePath(`/o/${org}/venues`);
    return { ok: true, venue: { id: row.id, name: row.name, city: row.city, timezone: row.timezone } };
  } catch (err) {
    return { ok: false, fields: failure(err).fields ?? [] };
  }
}
