'use server';

import {
  addOccurrencesCommand,
  addRecurringOccurrencesCommand,
  cancelOccurrenceCommand,
  previewOccurrencesQuery,
  type RecurrenceRuleInput,
  setEventSeriesCommand,
  updateOccurrenceCommand,
} from '@yayatoh/events';
import { executeCommand, executeQuery, isDomainError, zonedTimeToUtc } from '@yayatoh/kernel';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export interface DateFormState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  readonly field?: string;
  /** How many dates were added or changed. */
  readonly count?: number;
}

export interface RecurrenceState extends DateFormState {
  /** Set by "Preview": the dates the rule would add, formatted in the event's timezone. */
  readonly preview?: {
    readonly dates: readonly string[];
    readonly total: number;
    readonly existing: number;
    readonly overLimit: boolean;
    readonly max: number;
  };
}

const failure = (err: unknown): DateFormState => {
  if (isDomainError(err)) {
    const d = err.details ?? {};
    // Schema errors name the input path (e.g. `rule.interval`, `dates.0.capacity`).
    const issue = Array.isArray(d.issues) ? (d.issues[0] as { path?: string } | undefined) : undefined;
    if (issue?.path)
      return { ok: false, code: err.code, reason: 'invalid', field: issue.path.split('.').at(-1) ?? '' };
    return {
      ok: false,
      code: err.code,
      ...(typeof d.reason === 'string' ? { reason: d.reason } : {}),
      ...(typeof d.field === 'string' ? { field: d.field } : {}),
    };
  }
  // An unparseable datetime-local value.
  if (err instanceof Error && /YYYY-MM-DDTHH:mm/.test(err.message))
    return { ok: false, code: 'validation_failed', reason: 'invalid_date' };
  throw err;
};

const capacityOf = (raw: string) => (raw ? Number(raw) : null);

/** Add one date (wall-clock start and end in the event's timezone). */
export async function addDateAction(
  org: string,
  event: string,
  _prev: DateFormState,
  form: FormData,
): Promise<DateFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const get = (k: string) => String(form.get(k) ?? '').trim();
  try {
    if (!get('startsAt'))
      return { ok: false, code: 'validation_failed', reason: 'invalid_date', field: 'startsAt' };
    if (!get('endsAt'))
      return { ok: false, code: 'validation_failed', reason: 'invalid_date', field: 'endsAt' };
    await executeCommand(
      addOccurrencesCommand,
      {
        eventId: ev.id,
        dates: [
          {
            startsAt: zonedTimeToUtc(get('startsAt'), ev.timezone),
            endsAt: zonedTimeToUtc(get('endsAt'), ev.timezone),
            capacity: capacityOf(get('capacity')),
          },
        ],
      },
      data.ctx,
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  return { ok: true, code: null, count: 1 };
}

function ruleFrom(form: FormData): RecurrenceRuleInput {
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const num = (k: string) => (get(k) ? Number(get(k)) : null);
  const byUntil = get('endMode') !== 'count';
  return {
    startDate: get('startDate'),
    startTime: get('startTime'),
    endTime: get('endTime'),
    freq: (get('freq') || 'weekly') as RecurrenceRuleInput['freq'],
    interval: num('interval') ?? 1,
    byWeekday: form.getAll('byWeekday').map(Number),
    byMonthDay: get('freq') === 'monthly' ? num('byMonthDay') : null,
    until: byUntil ? get('until') || null : null,
    count: byUntil ? null : num('count'),
  };
}

/** "Preview" shows the dates a rule would add; "Save" adds them. */
export async function recurrenceAction(
  org: string,
  event: string,
  _prev: RecurrenceState,
  form: FormData,
): Promise<RecurrenceState> {
  const { data, event: ev } = await loadEvent(org, event);
  const rule = ruleFrom(form);
  const capacity = capacityOf(String(form.get('capacity') ?? '').trim());
  try {
    if (form.get('intent') === 'save') {
      const r = await executeCommand(
        addRecurringOccurrencesCommand,
        { eventId: ev.id, rule, capacity },
        data.ctx,
        ports,
      );
      revalidatePath(`/o/${org}/e/${event}`, 'layout');
      return { ok: true, code: null, count: r.created };
    }
    const p = await executeQuery(previewOccurrencesQuery, { eventId: ev.id, rule }, data.ctx, ports);
    const fmt = new Intl.DateTimeFormat(data.ctx.locale, {
      timeZone: ev.timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return {
      ok: false,
      code: null,
      preview: {
        dates: p.dates.slice(0, 60).map((d) => fmt.formatRange(d.startsAt, d.endsAt)),
        total: p.dates.length,
        existing: p.existing,
        overLimit: p.overLimit,
        max: p.max,
      },
    };
  } catch (err) {
    return failure(err);
  }
}

/** Change one date, or this date and all later ones (their time of day). */
export async function updateDateAction(
  org: string,
  event: string,
  occurrenceId: string,
  _prev: DateFormState,
  form: FormData,
): Promise<DateFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const capacity = capacityOf(get('capacity'));
  try {
    if (!get('startsAt') || !get('endsAt'))
      return {
        ok: false,
        code: 'validation_failed',
        reason: 'invalid_date',
        field: get('startsAt') ? 'endsAt' : 'startsAt',
      };
    const r =
      get('scope') === 'following'
        ? await executeCommand(
            updateOccurrenceCommand,
            {
              scope: 'following',
              occurrenceId,
              startTime: get('startsAt').slice(11, 16),
              endTime: get('endsAt').slice(11, 16),
              capacity,
            },
            data.ctx,
            ports,
          )
        : await executeCommand(
            updateOccurrenceCommand,
            {
              scope: 'one',
              occurrenceId,
              startsAt: zonedTimeToUtc(get('startsAt'), ev.timezone),
              endsAt: zonedTimeToUtc(get('endsAt'), ev.timezone),
              capacity,
            },
            data.ctx,
            ports,
          );
    revalidatePath(`/o/${org}/e/${event}`, 'layout');
    return { ok: true, code: null, count: r.updated };
  } catch (err) {
    return failure(err);
  }
}

export async function cancelDateAction(org: string, event: string, occurrenceId: string): Promise<void> {
  const { data } = await loadEvent(org, event);
  await executeCommand(cancelOccurrenceCommand, { occurrenceId }, data.ctx, ports);
  revalidatePath(`/o/${org}/e/${event}`, 'layout');
  redirect({ href: `/o/${org}/e/${event}/dates?cancelled=1`, locale: await getLocale() });
}

export async function setSeriesAction(
  org: string,
  event: string,
  _prev: DateFormState,
  form: FormData,
): Promise<DateFormState> {
  const { data, event: ev } = await loadEvent(org, event);
  const seriesId = String(form.get('seriesId') ?? '') || null;
  try {
    await executeCommand(setEventSeriesCommand, { eventId: ev.id, seriesId }, data.ctx, ports);
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/o/${org}`, 'layout');
  return { ok: true, code: null };
}
