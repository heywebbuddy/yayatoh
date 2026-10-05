'use server';

import { createEventCommand, getEventQuery } from '@yayatoh/events';
import { executeCommand, executeQuery, isDomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import {
  deleteLayoutCommand,
  renameLayoutCommand,
  setEventLayoutCommand,
  useSharedLayoutCommand,
} from '@yayatoh/seating';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDEMPOTENT_CREATE = { ...createEventCommand, idempotent: true };

export interface StartEventState {
  readonly code: string | null;
  readonly field?: 'layoutId' | 'name' | 'profile' | 'startsAt' | 'endsAt' | 'slug';
}

/**
 * The venue layout library (M6.11b): start a new event from a saved plan. The event is created
 * (idempotent per form) and gets its own copy of the plan; the organizer lands on its seating
 * page to price the seats and put them on sale. Times are wall-clock in the chosen time zone.
 */
export async function startEventFromLayoutAction(
  org: string,
  _prev: StartEventState,
  form: FormData,
): Promise<StartEventState> {
  const data = await loadConsole(org);
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const layoutId = get('layoutId');
  if (!UUID.test(layoutId)) return { code: 'validation_failed', field: 'layoutId' };
  const name = get('name');
  if (name.length < 2 || name.length > 160) return { code: 'validation_failed', field: 'name' };
  const profile = get('profile');
  // Only profiles whose console has a seating page can start from a plan.
  if (!isProfileKey(profile) || !composeNav(profile, data.modules).some((i) => i.path === 'seating'))
    return { code: 'validation_failed', field: 'profile' };
  const timezone = get('timezone') || data.org.timezone;
  let startsAt: Date;
  let endsAt: Date;
  try {
    startsAt = zonedTimeToUtc(get('startsAt'), timezone);
  } catch {
    return { code: 'validation_failed', field: 'startsAt' };
  }
  try {
    endsAt = zonedTimeToUtc(get('endsAt'), timezone);
  } catch {
    return { code: 'validation_failed', field: 'endsAt' };
  }
  if (endsAt <= startsAt) return { code: 'validation_failed', field: 'endsAt' };
  const requestKey = get('requestKey');
  const input = { name, profile, timezone, startsAt, endsAt, currency: data.org.currency };
  let created: { id: string; slug: string };
  try {
    created = requestKey
      ? await executeCommand(IDEMPOTENT_CREATE, input, { ...data.ctx, idempotencyKey: requestKey }, ports)
      : await executeCommand(createEventCommand, input, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const field = err.details?.field;
    return {
      code: err.code,
      ...(field === 'slug' || field === 'name' || field === 'startsAt' || field === 'endsAt'
        ? { field }
        : {}),
    };
  }
  try {
    await executeCommand(setEventLayoutCommand, { eventId: created.id, layoutId }, data.ctx, ports);
  } catch (err) {
    // The event exists (a resubmit replays it): its seating page offers the library again.
    if (!isDomainError(err)) throw err;
  }
  return redirect({ href: `/o/${org}/e/${created.slug}/seating?fromLibrary=1`, locale: await getLocale() });
}

export type LibraryState = { readonly ok: boolean; readonly code: string | null };

export async function renameLayoutAction(
  org: string,
  id: string,
  _prev: LibraryState,
  form: FormData,
): Promise<LibraryState> {
  const data = await loadConsole(org);
  try {
    await executeCommand(renameLayoutCommand, { id, name: String(form.get('name') ?? '') }, data.ctx, ports);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { ok: false, code: err.code };
  }
  revalidatePath(`/o/${org}/seating-library`);
  return { ok: true, code: null };
}

export async function deleteLayoutAction(org: string, id: string): Promise<void> {
  const data = await loadConsole(org);
  await executeCommand(deleteLayoutCommand, { id }, data.ctx, ports);
  revalidatePath(`/o/${org}/seating-library`);
  return redirect({ href: `/o/${org}/seating-library?deleted=1`, locale: await getLocale() });
}

export type UseSharedState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'used';
      readonly eventName: string;
      readonly eventSlug: string;
      readonly venueName: string;
    }
  | {
      readonly kind: 'error';
      readonly code: string;
      readonly field?: 'layoutId' | 'eventId';
      /** `seats_in_use`, `layout_locked`. */
      readonly reason?: string;
    };

/**
 * M6.14b: copy a venue's shared plan into one of the org's events (copy-on-use). The event keeps
 * its own copy; the venue sees the event's name, date and status.
 */
export async function useSharedLayoutAction(
  org: string,
  _prev: UseSharedState,
  form: FormData,
): Promise<UseSharedState> {
  const data = await loadConsole(org);
  const layoutId = String(form.get('layoutId') ?? '');
  const eventId = String(form.get('eventId') ?? '');
  if (!UUID.test(layoutId)) return { kind: 'error', code: 'validation_failed', field: 'layoutId' };
  if (!UUID.test(eventId)) return { kind: 'error', code: 'validation_failed', field: 'eventId' };
  try {
    const r = await executeCommand(useSharedLayoutCommand, { eventId, layoutId }, data.ctx, ports);
    const event = await executeQuery(getEventQuery, { eventId }, data.ctx, ports);
    revalidatePath(`/o/${org}/seating-library`);
    return { kind: 'used', eventName: event.name, eventSlug: event.slug, venueName: r.venueName };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const field = err.details?.field;
    if (field === 'layoutId' || field === 'eventId') return { kind: 'error', code: err.code, field };
    const reason = typeof err.details?.reason === 'string' ? err.details.reason : undefined;
    return { kind: 'error', code: err.code, ...(reason ? { reason } : {}) };
  }
}
