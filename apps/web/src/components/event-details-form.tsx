'use client';

import type { EventDetailsDto } from '@yayatoh/events';
import { ATTENDANCE_MODES, EVENT_CATEGORIES } from '@yayatoh/events/ui';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/** Venue, category, attendance mode and tags of one event (M1.4c/d). */
export function EventDetailsForm({
  action,
  details,
  visibility,
  venues,
  disabled,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  details: EventDetailsDto;
  visibility: 'public' | 'unlisted' | 'private';
  venues: readonly { id: string; name: string; city: string | null }[];
  disabled: boolean;
}) {
  const t = useTranslations('details');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const selectClass = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
  const tagError =
    state.fields?.includes('tags') && state.reason
      ? t(`tagErrors.${state.reason}` as 'tagErrors.too_many_tags')
      : undefined;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-5">
      <fieldset disabled={disabled} className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <legend className="sr-only">{t('legend')}</legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="details-venue" className="text-caption text-zinc-600">
            {t('venue')}
          </label>
          <select
            id="details-venue"
            name="venueId"
            defaultValue={details.venueId ?? ''}
            className={selectClass}
            aria-describedby="details-venue-hint"
          >
            <option value="">{t('noVenue')}</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.city ? `${v.name} · ${v.city}` : v.name}
              </option>
            ))}
          </select>
          <p id="details-venue-hint" className="text-caption text-zinc-500">
            {details.venueName && !details.venueId
              ? t('freeTextVenue', { venue: details.venueName })
              : t('venueHint')}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="details-category" className="text-caption text-zinc-600">
            {t('category')}
          </label>
          <select
            id="details-category"
            name="category"
            defaultValue={details.category ?? ''}
            className={selectClass}
          >
            <option value="">{t('noCategory')}</option>
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {te(`categories.${c}`)}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="text-caption text-zinc-600">{t('visibility')}</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(['public', 'unlisted', 'private'] as const).map((v) => (
              <label key={v} className="flex min-h-6 items-center gap-2 text-body">
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  defaultChecked={visibility === v}
                  className="size-5"
                />
                {t(`visibilities.${v}`)}
              </label>
            ))}
          </div>
          <p className="text-caption text-zinc-500">{t('visibilityHint')}</p>
        </fieldset>
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="text-caption text-zinc-600">{t('attendanceMode')}</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {ATTENDANCE_MODES.map((m) => (
              <label key={m} className="flex min-h-6 items-center gap-2 text-body">
                <input
                  type="radio"
                  name="attendanceMode"
                  value={m}
                  defaultChecked={details.attendanceMode === m}
                  className="size-5"
                />
                {t(`modes.${m}`)}
              </label>
            ))}
          </div>
          <p className="text-caption text-zinc-500">{t('attendanceHint')}</p>
        </fieldset>
        <div className="md:col-span-2">
          <Input
            name="tags"
            label={t('tags')}
            hint={t('tagsHint')}
            defaultValue={details.tags.join(', ')}
            error={tagError}
            maxLength={600}
          />
        </div>
      </fieldset>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && !tagError ? <Alert title={te(errorMessageKey(state.code))} /> : null}
      </div>
      {disabled ? null : (
        <Button type="submit" disabled={pending} className="self-start">
          {t('save')}
        </Button>
      )}
    </form>
  );
}

/** The vanity short link (M1.4d): validated on the server; the reason names what to fix. */
export function VanityForm({
  action,
  current,
  origin,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  current: string | null;
  origin: string;
}) {
  const t = useTranslations('details');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const error = state.code
    ? state.reason
      ? t(`vanityErrors.${state.reason}` as 'vanityErrors.reserved')
      : te(errorMessageKey(state.code))
    : undefined;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-3">
      <Input
        name="code"
        label={t('vanity')}
        hint={t('vanityHint', { example: `${origin}/e/summer-gala` })}
        defaultValue={current ?? ''}
        maxLength={40}
        autoCapitalize="none"
        spellCheck={false}
        error={error}
      />
      <div aria-live="polite">
        {state.ok && !pending ? <Alert tone="info" title={t('vanitySaved')} /> : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('vanitySave')}
      </Button>
    </form>
  );
}
