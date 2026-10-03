'use client';

import type { EventDetailsDto } from '@yayatoh/events';
import { ATTENDANCE_MODES, MAX_TAG_LENGTH, tagKey } from '@yayatoh/events/ui';
import { Alert, Button, Combobox, CurrencyPicker, Input, Select, type SelectOption } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/** One org category as a picker shows it (U8): its ref and its label (own name or platform label). */
export interface CategoryChoice {
  readonly ref: string;
  readonly label: string;
  readonly hidden: boolean;
}

/** A tag as the combobox submits it: the spelling typed first; matched case-insensitively. */
function tagOption(tag: string): SelectOption {
  return { value: tag, label: tag, text: tag };
}

/** Venue, category, attendance mode and tags of one event (M1.4c/d; U8 org categories and tags). */
export function EventDetailsForm({
  action,
  details,
  visibility,
  venues,
  categories,
  orgTags,
  manageCategoriesHref,
  disabled,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  details: EventDetailsDto;
  visibility: 'public' | 'unlisted' | 'private';
  venues: readonly { id: string; name: string; city: string | null }[];
  /** The visible org categories, plus the event's own when it is hidden. */
  categories: readonly CategoryChoice[];
  /** The org's tags (suggestions). */
  orgTags: readonly string[];
  /** Where owners and admins manage categories (null for everyone else). */
  manageCategoriesHref: string | null;
  disabled: boolean;
}) {
  const t = useTranslations('details');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const selectClass = 'field';
  const tagError =
    state.fields?.includes('tags') && state.reason
      ? t(`tagErrors.${state.reason}` as 'tagErrors.too_many_tags')
      : undefined;
  const categoryError =
    state.fields?.includes('category') && state.code ? te(errorMessageKey(state.code)) : undefined;
  const tagOptions = orgTags.map(tagOption);
  // Controlled, so a new tag that matches a chosen one (any case) is not added twice.
  const [tags, setTags] = useState<string[]>(() => [...details.tags]);
  // A new tag: the existing spelling when it matches one case-insensitively, else as typed.
  const createTag = (query: string): SelectOption => {
    const typed = query
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, MAX_TAG_LENGTH * 2);
    const same = [...tags, ...orgTags].find((x) => tagKey(x) === tagKey(typed));
    return tagOption(same ?? typed);
  };
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-5">
      <fieldset disabled={disabled} className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <legend className="sr-only">{t('legend')}</legend>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="details-venue" className="text-[13px] font-bold text-ink">
            {t('venue')}
          </label>
          <Select
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
          </Select>
          <p id="details-venue-hint" className="text-caption text-ink-2">
            {details.venueName && !details.venueId
              ? t('freeTextVenue', { venue: details.venueName })
              : t('venueHint')}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="details-category" className="text-[13px] font-bold text-ink">
            {t('category')}
          </label>
          <Select
            id="details-category"
            name="category"
            defaultValue={details.categoryRef ?? ''}
            className={selectClass}
            aria-describedby="details-category-hint"
            error={categoryError}
          >
            <option value="">{t('noCategory')}</option>
            {categories.map((c) => (
              <option key={c.ref} value={c.ref}>
                {c.hidden ? t('hiddenCategory', { name: c.label }) : c.label}
              </option>
            ))}
          </Select>
          <p id="details-category-hint" className="text-caption text-ink-2">
            {details.categoryHidden ? `${t('categoryHiddenHint')} ` : ''}
            {manageCategoriesHref ? (
              <Link href={manageCategoriesHref} className="underline underline-offset-2">
                {t('manageCategories')}
              </Link>
            ) : null}
          </p>
        </div>
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="text-[13px] font-bold text-ink">{t('visibility')}</legend>
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
          <p className="text-caption text-ink-2">{t('visibilityHint')}</p>
        </fieldset>
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="text-[13px] font-bold text-ink">{t('attendanceMode')}</legend>
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
          <p className="text-caption text-ink-2">{t('attendanceHint')}</p>
        </fieldset>
        <div className="md:col-span-2">
          <Combobox
            name="tags"
            multiple
            label={t('tags')}
            hint={t('tagsHint')}
            value={tags}
            onValueChange={setTags}
            options={tagOptions}
            selectedOptions={details.tags.map(tagOption)}
            onCreate={createTag}
            error={tagError}
            disabled={disabled}
          />
        </div>
      </fieldset>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && !tagError && !categoryError ? <Alert title={te(errorMessageKey(state.code))} /> : null}
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

/**
 * U9 (UX-6): the event's own currency. It can change until the first order; after that the
 * picker is read-only and says why (the server refuses a change too).
 */
export function EventCurrencyForm({
  action,
  currency,
  locked,
  disabled,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  currency: string;
  locked: boolean;
  disabled: boolean;
}) {
  const t = useTranslations('details');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const error = state.code
    ? state.reason === 'currency_locked'
      ? t('currencyLocked')
      : te(errorMessageKey(state.code))
    : undefined;
  const readOnly = locked || disabled;
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-3">
      <CurrencyPicker
        id="event-currency"
        name="currency"
        required
        defaultValue={currency}
        disabled={readOnly}
        label={t('currency')}
        hint={locked ? t('currencyLocked') : t('currencyHint')}
        error={error}
        className="field sm:max-w-sm"
      />
      <div aria-live="polite">
        {state.ok && !pending ? <Alert tone="info" title={t('currencySaved')} /> : null}
      </div>
      {readOnly ? null : (
        <Button type="submit" variant="secondary" disabled={pending} className="self-start">
          {t('currencySave')}
        </Button>
      )}
    </form>
  );
}
