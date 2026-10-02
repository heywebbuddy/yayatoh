'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from 'react';
import type { DateFormState, RecurrenceState } from '@/app/[locale]/o/[org]/e/[event]/dates/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Action<S> = (prev: S, form: FormData) => Promise<S>;

const PROBLEMS = new Set([
  'invalid',
  'invalid_date',
  'invalid_time',
  'invalid_interval',
  'invalid_count',
  'invalid_weekday',
  'invalid_month_day',
  'no_end',
  'both_ends',
  'until_before_start',
  'too_far',
  'too_many',
  'no_dates',
  'date_exists',
  'end_before_start',
  'event_finished',
  'cancelled',
]);
const select = 'field';

/** The message for a refused form, and the field it belongs to (shown next to that field). */
function useProblem(state: DateFormState) {
  const t = useTranslations();
  if (!state.code) return { message: null, field: undefined as string | undefined };
  const message =
    state.reason && PROBLEMS.has(state.reason)
      ? t(`dates.problem.${state.reason}`)
      : t(errorMessageKey(state.code));
  return { message, field: state.field };
}

/** Submit without React's form reset, so a refused form keeps what was typed. */
function useKeepValues(formAction: (f: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(data));
  };
}

export function AddDateForm({ action }: { action: Action<DateFormState> }) {
  const t = useTranslations('dates');
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const ref = useRef<HTMLFormElement>(null);
  const onSubmit = useKeepValues(formAction);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  const { message, field } = useProblem(state);
  const err = (f: string) => (field === f ? (message ?? undefined) : undefined);
  return (
    <form ref={ref} onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-3" noValidate>
      <Input
        id="add-startsAt"
        name="startsAt"
        type="datetime-local"
        required
        label={t('startsAt')}
        error={err('startsAt')}
      />
      <Input
        id="add-endsAt"
        name="endsAt"
        type="datetime-local"
        required
        label={t('endsAt')}
        error={err('endsAt')}
      />
      <Input
        id="add-capacity"
        name="capacity"
        type="number"
        min={1}
        label={t('capacity')}
        hint={t('capacityHint')}
        error={err('capacity')}
      />
      <div className="flex flex-col gap-2 md:col-span-3">
        <div aria-live="polite">
          {state.ok ? <Alert tone="info" title={t('added', { count: state.count ?? 1 })} /> : null}
          {message && !['startsAt', 'endsAt', 'capacity'].includes(field ?? '') ? (
            <Alert title={message} />
          ) : null}
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {t('add')}
        </Button>
      </div>
    </form>
  );
}

/** Mon … Sun in the viewer's language (ISO weekday 1–7). */
function weekdayNames(locale: string) {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
}

export function RecurrenceForm({
  action,
  defaults,
}: {
  action: Action<RecurrenceState>;
  defaults: { startDate: string; startTime: string; endTime: string; weekday: number };
}) {
  const t = useTranslations('dates');
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const [freq, setFreq] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [endMode, setEndMode] = useState<'until' | 'count'>('count');
  const onSubmit = useKeepValues(formAction);
  const { message, field } = useProblem(state);
  const err = (...f: string[]) => (field && f.includes(field) ? (message ?? undefined) : undefined);
  const inline = [
    'startDate',
    'startTime',
    'endTime',
    'interval',
    'byMonthDay',
    'until',
    'count',
    'capacity',
  ];
  const days = weekdayNames(locale);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Input
          id="rr-startDate"
          name="startDate"
          type="date"
          required
          defaultValue={defaults.startDate}
          label={t('firstDate')}
          error={err('startDate')}
        />
        <Input
          id="rr-startTime"
          name="startTime"
          type="time"
          required
          defaultValue={defaults.startTime}
          label={t('startTime')}
          error={err('startTime')}
        />
        <Input
          id="rr-endTime"
          name="endTime"
          type="time"
          required
          defaultValue={defaults.endTime}
          label={t('endTime')}
          hint={t('endTimeHint')}
          error={err('endTime')}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rr-freq" className="text-caption text-ink-2">
            {t('freq')}
          </label>
          <select
            id="rr-freq"
            name="freq"
            value={freq}
            onChange={(e) => setFreq(e.target.value as typeof freq)}
            className={select}
          >
            <option value="daily">{t('freqs.daily')}</option>
            <option value="weekly">{t('freqs.weekly')}</option>
            <option value="monthly">{t('freqs.monthly')}</option>
          </select>
        </div>
        <Input
          id="rr-interval"
          name="interval"
          type="number"
          min={1}
          max={52}
          defaultValue={1}
          label={t('interval')}
          hint={t(`intervalHint.${freq}`)}
          error={err('interval')}
        />
        {freq === 'monthly' ? (
          <Input
            id="rr-byMonthDay"
            name="byMonthDay"
            type="number"
            min={1}
            max={31}
            defaultValue={Number(defaults.startDate.slice(8, 10)) || 1}
            label={t('monthDay')}
            hint={t('monthDayHint')}
            error={err('byMonthDay')}
          />
        ) : null}
      </div>
      {freq === 'weekly' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-caption text-ink-2">{t('weekdays')}</legend>
          <div className="flex flex-wrap gap-2">
            {days.map((d, i) => (
              <label
                key={d}
                className="flex min-h-10 items-center gap-2 rounded-pill border border-line bg-surface px-3 text-body"
              >
                <input
                  type="checkbox"
                  name="byWeekday"
                  value={i + 1}
                  defaultChecked={i + 1 === defaults.weekday}
                  className="size-5 accent-primary"
                />
                {d}
              </label>
            ))}
          </div>
          <p className="text-caption text-ink-2">{t('weekdaysHint')}</p>
        </fieldset>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-ink-2">{t('ends')}</legend>
        <div className="flex flex-wrap gap-4">
          {(['count', 'until'] as const).map((m) => (
            <label key={m} className="flex min-h-6 items-center gap-2 text-body">
              <input
                type="radio"
                name="endMode"
                value={m}
                checked={endMode === m}
                onChange={() => setEndMode(m)}
                className="size-5 accent-primary"
              />
              {t(m === 'count' ? 'endsAfter' : 'endsOn')}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {endMode === 'count' ? (
            <Input
              id="rr-count"
              name="count"
              type="number"
              min={1}
              max={366}
              defaultValue={4}
              label={t('count')}
              error={err('count')}
            />
          ) : (
            <Input id="rr-until" name="until" type="date" label={t('until')} error={err('until')} />
          )}
          <Input
            id="rr-capacity"
            name="capacity"
            type="number"
            min={1}
            label={t('capacity')}
            hint={t('capacityHint')}
            error={err('capacity')}
          />
        </div>
      </fieldset>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok ? <Alert tone="info" title={t('added', { count: state.count ?? 0 })} /> : null}
        {message && !inline.includes(field ?? '') ? <Alert title={message} /> : null}
        {!state.code && state.preview ? (
          <section
            aria-labelledby="preview-heading"
            className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
          >
            <h3 id="preview-heading" className="text-body font-medium">
              {t('previewTitle', { count: state.preview.total })}
            </h3>
            {state.preview.overLimit ? (
              <Alert title={t('overLimit', { max: state.preview.max, existing: state.preview.existing })} />
            ) : null}
            <ol className="flex list-none flex-col gap-1 p-0 text-body">
              {state.preview.dates.map((d) => (
                <li key={d} className="font-mono text-caption">
                  {d}
                </li>
              ))}
            </ol>
            {state.preview.total > state.preview.dates.length ? (
              <p className="text-caption text-ink-2">
                {t('previewMore', { count: state.preview.total - state.preview.dates.length })}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="preview" variant="secondary" disabled={pending}>
          {t('preview')}
        </Button>
        {!state.code && state.preview && !state.preview.overLimit ? (
          <Button type="submit" name="intent" value="save" disabled={pending}>
            {t('save', { count: state.preview.total })}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function EditDateForm({
  action,
  defaults,
  canFollow,
}: {
  action: Action<DateFormState>;
  defaults: { startsAt: string; endsAt: string; capacity: number | null };
  /** Later scheduled dates exist. */
  canFollow: boolean;
}) {
  const t = useTranslations('dates');
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const onSubmit = useKeepValues(formAction);
  const { message, field } = useProblem(state);
  const err = (f: string) => (field === f ? (message ?? undefined) : undefined);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Input
          id="edit-startsAt"
          name="startsAt"
          type="datetime-local"
          required
          defaultValue={defaults.startsAt}
          label={t('startsAt')}
          error={err('startsAt') ?? err('startTime')}
        />
        <Input
          id="edit-endsAt"
          name="endsAt"
          type="datetime-local"
          required
          defaultValue={defaults.endsAt}
          label={t('endsAt')}
          error={err('endsAt') ?? err('endTime')}
        />
        <Input
          id="edit-capacity"
          name="capacity"
          type="number"
          min={1}
          defaultValue={defaults.capacity ?? ''}
          label={t('capacity')}
          hint={t('capacityHint')}
          error={err('capacity')}
        />
      </div>
      {canFollow ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-caption text-ink-2">{t('scope')}</legend>
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input type="radio" name="scope" value="one" defaultChecked className="size-5 accent-primary" />
            {t('scopeOne')}
          </label>
          <label className="flex min-h-6 items-start gap-2 text-body">
            <input type="radio" name="scope" value="following" className="mt-0.5 size-5 accent-primary" />
            <span>
              {t('scopeFollowing')}
              <span className="block text-caption text-ink-2">{t('scopeFollowingHint')}</span>
            </span>
          </label>
        </fieldset>
      ) : (
        <input type="hidden" name="scope" value="one" />
      )}
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('updated', { count: state.count ?? 1 })} /> : null}
        {message && !['startsAt', 'endsAt', 'startTime', 'endTime', 'capacity'].includes(field ?? '') ? (
          <Alert title={message} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('saveChanges')}
      </Button>
    </form>
  );
}

export function SeriesPicker({
  action,
  series,
  current,
}: {
  action: Action<DateFormState>;
  series: readonly { id: string; name: string }[];
  current: string | null;
}) {
  const t = useTranslations('dates');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-56 flex-col gap-1.5">
        <label htmlFor="seriesId" className="text-caption text-ink-2">
          {t('series')}
        </label>
        <select id="seriesId" name="seriesId" defaultValue={current ?? ''} className={select}>
          <option value="">{t('noSeries')}</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {t('saveSeries')}
      </Button>
      <div aria-live="polite" className="basis-full">
        {state.ok ? <Alert tone="info" title={t('seriesSaved')} /> : null}
        {state.code ? <Alert title={te(errorMessageKey(state.code))} /> : null}
      </div>
    </form>
  );
}
