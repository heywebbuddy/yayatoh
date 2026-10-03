'use client';

import { Alert, Button, DateTimePicker, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { SeriesActionState } from '@/app/[locale]/o/[org]/(org)/series/[series]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Action = (prev: SeriesActionState, form: FormData) => Promise<SeriesActionState>;
const INITIAL: SeriesActionState = { ok: false, code: null };

/** U7: add one of the org's events to the series (an event in another series moves here). */
export function AddEventToSeriesForm({
  action,
  events,
}: {
  action: Action;
  events: readonly { id: string; name: string; when: string; otherSeries: string | null }[];
}) {
  const t = useTranslations('seriesPage.add');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const missing = state.field === 'eventId' && state.code === 'validation_failed';
  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <Select
        id="series-add-event"
        name="eventId"
        label={t('label')}
        hint={t('hint')}
        error={missing ? t('required') : undefined}
        defaultValue=""
        options={[
          { value: '', text: t('placeholder'), label: t('placeholder') },
          ...events.map((e) => {
            const text = e.otherSeries
              ? t('optionMoves', { name: e.name, when: e.when, series: e.otherSeries })
              : t('option', { name: e.name, when: e.when });
            return { value: e.id, text, label: text };
          }),
        ]}
      />
      <div aria-live="polite">
        {state.code && !missing ? <Alert title={tr(errorMessageKey(state.code))} /> : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}

/** U7: "Create next event in series" — the copy's name and start (wall time in the event's zone). */
export function NextEventForm({
  action,
  defaults,
  timeZone,
}: {
  action: Action;
  defaults: { name: string; startsAt: string };
  timeZone: string;
}) {
  const t = useTranslations('seriesPage.next');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const nameError = state.field === 'name' ? t('nameInvalid') : undefined;
  const startError = state.field === 'startsAt' ? t('startInvalid') : undefined;
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Input
        id="next-name"
        name="name"
        required
        minLength={2}
        maxLength={160}
        label={t('name')}
        defaultValue={defaults.name}
        error={nameError}
      />
      <DateTimePicker
        id="next-starts"
        name="startsAt"
        required
        label={t('startsAt')}
        hint={t('startsAtHint', { zone: timeZone.replace(/_/g, ' ') })}
        defaultValue={defaults.startsAt}
        timeZone={timeZone}
        error={startError}
      />
      <div aria-live="polite">
        {state.code && !nameError && !startError ? <Alert title={tr(errorMessageKey(state.code))} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}

/** U7: the series' name and description (the public address stays). */
export function SeriesDetailsForm({
  action,
  defaults,
}: {
  action: Action;
  defaults: { name: string; description: string | null };
}) {
  const t = useTranslations('seriesPage.details');
  const tr = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const nameError = state.field === 'name' ? tr('series.nameInvalid') : undefined;
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Input
        id="series-edit-name"
        name="name"
        required
        minLength={2}
        maxLength={160}
        label={tr('series.name')}
        defaultValue={defaults.name}
        error={nameError}
      />
      <Input
        id="series-edit-description"
        name="description"
        maxLength={2000}
        label={tr('series.descriptionField')}
        defaultValue={defaults.description ?? ''}
      />
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && !nameError ? <Alert title={tr(errorMessageKey(state.code))} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('save')}
      </Button>
    </form>
  );
}
