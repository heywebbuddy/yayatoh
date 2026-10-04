'use server';

import { deleteSeriesCommand, setEventSeriesCommand, updateSeriesCommand } from '@yayatoh/events';
import { executeCommand, isDomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import { duplicateEventCommand } from '@yayatoh/templates';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { loadSeries } from './data.ts';

export interface SeriesActionState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly field?: string;
}

const failure = (err: unknown): SeriesActionState => {
  if (!isDomainError(err)) {
    if (err instanceof Error && /YYYY-MM-DDTHH:mm/.test(err.message))
      return { ok: false, code: 'validation_failed', field: 'startsAt' };
    throw err;
  }
  const d = err.details ?? {};
  const issue = Array.isArray(d.issues) ? (d.issues[0] as { path?: string } | undefined) : undefined;
  const field = typeof d.field === 'string' ? d.field : issue?.path;
  return field ? { ok: false, code: err.code, field } : { ok: false, code: err.code };
};

const back = async (org: string, slug: string, done: string) => {
  revalidatePath(`/o/${org}`, 'layout');
  return redirect({ href: `/o/${org}/series/${slug}?done=${done}`, locale: await getLocale() });
};

/** Put one of the org's events in this series (moving it out of any other series). */
export async function addEventToSeriesAction(
  org: string,
  slug: string,
  _prev: SeriesActionState,
  form: FormData,
): Promise<SeriesActionState> {
  const { data, series } = await loadSeries(org, slug);
  const eventId = String(form.get('eventId') ?? '');
  if (!eventId) return { ok: false, code: 'validation_failed', field: 'eventId' };
  try {
    await executeCommand(setEventSeriesCommand, { eventId, seriesId: series.id }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  return back(org, slug, 'added');
}

/** Take an event out of this series; the event itself stays. */
export async function removeEventFromSeriesAction(org: string, slug: string, eventId: string): Promise<void> {
  const { data, series } = await loadSeries(org, slug);
  // Only an event of this series: a stale page never unlinks an event from another series.
  if (!series.events.some((e) => e.id === eventId)) return back(org, slug, 'removed');
  await executeCommand(setEventSeriesCommand, { eventId, seriesId: null }, data.ctx, ports);
  return back(org, slug, 'removed');
}

/**
 * "Create next event in series": duplicate the latest event (settings, ticket types, questions,
 * seating; never orders) as a draft in this series, then open it.
 */
export async function createNextEventAction(
  org: string,
  slug: string,
  _prev: SeriesActionState,
  form: FormData,
): Promise<SeriesActionState> {
  const { data, series } = await loadSeries(org, slug);
  const latest = series.events.at(-1);
  if (!latest) return { ok: false, code: 'invalid_state' };
  const startsAt = String(form.get('startsAt') ?? '').trim();
  if (!startsAt) return { ok: false, code: 'validation_failed', field: 'startsAt' };
  let next: string;
  try {
    const copy = await executeCommand(
      duplicateEventCommand,
      {
        eventId: latest.id,
        name: String(form.get('name') ?? '').trim(),
        startsAt: zonedTimeToUtc(startsAt, latest.timezone),
      },
      data.ctx,
      ports,
    );
    next = copy.slug;
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}`, 'layout');
  return redirect({ href: `/o/${org}/e/${next}`, locale: await getLocale() });
}

/** Rename the series or change its description (its address stays). */
export async function updateSeriesDetailsAction(
  org: string,
  slug: string,
  _prev: SeriesActionState,
  form: FormData,
): Promise<SeriesActionState> {
  const { data, series } = await loadSeries(org, slug);
  try {
    await executeCommand(
      updateSeriesCommand,
      {
        seriesId: series.id,
        name: String(form.get('name') ?? '').trim(),
        description: String(form.get('description') ?? '').trim() || null,
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}`, 'layout');
  return { ok: true, code: null };
}

/** Delete the series; its events stay and leave it. */
export async function deleteSeriesFromPageAction(org: string, slug: string): Promise<void> {
  const { data, series } = await loadSeries(org, slug);
  await executeCommand(deleteSeriesCommand, { seriesId: series.id }, data.ctx, ports);
  revalidatePath(`/o/${org}`, 'layout');
  return redirect({ href: `/o/${org}/series?deleted=1`, locale: await getLocale() });
}
