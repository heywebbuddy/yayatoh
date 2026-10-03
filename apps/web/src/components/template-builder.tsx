'use client';

import { Alert, Button, CurrencyPicker, Input, Radio, Select, TimeZonePicker } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

/**
 * U6 template builder forms. Short forms (UX principle 4): the new-template form asks only for
 * the kind of event and its defaults; tickets, page sections, content and the checklist follow on
 * the template's own page, each on its own small form.
 */

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

function useBuilderForm(action: Action, resetOnSuccess = false) {
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const bad = new Set(state.fields ?? []);
  return { state, formAction, pending, ref, bad };
}

/** A failure no field explains (a refused permission, an archived template…). */
function FormError({ state, handled }: { state: FormState; handled: boolean }) {
  const te = useTranslations();
  if (!state.code || handled) return null;
  return <Alert title={te(errorMessageKey(state.code))} />;
}

function DurationFields({
  idPrefix,
  minutes,
  invalid,
}: {
  idPrefix: string;
  minutes: number;
  invalid: boolean;
}) {
  const t = useTranslations('templateBuilder');
  const errorId = `${idPrefix}-duration-error`;
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" aria-describedby={errorId}>
      <legend className="pb-1.5 text-[13px] font-bold text-ink">{t('duration')}</legend>
      <div className="grid grid-cols-2 gap-3">
        <Input
          id={`${idPrefix}-hours`}
          name="hours"
          type="number"
          inputMode="numeric"
          min={0}
          max={336}
          defaultValue={Math.floor(minutes / 60)}
          label={t('hours')}
          aria-invalid={invalid ? true : undefined}
        />
        <Input
          id={`${idPrefix}-minutes`}
          name="minutes"
          type="number"
          inputMode="numeric"
          min={0}
          max={59}
          step={5}
          defaultValue={minutes % 60}
          label={t('minutes')}
          aria-invalid={invalid ? true : undefined}
        />
      </div>
      <p id={errorId} className={invalid ? 'text-caption text-danger' : 'text-caption text-ink-2'}>
        {invalid ? t('durationInvalid') : t('durationHint')}
      </p>
    </fieldset>
  );
}

/** Step 1: the kind of event (with what it switches on), a name and the defaults. */
export function NewTemplateForm({
  action,
  profiles,
  defaults,
}: {
  action: Action;
  profiles: readonly { key: string; label: string }[];
  defaults: { timezone: string; currency: string };
}) {
  const t = useTranslations('templateBuilder');
  const { state, formAction, pending, ref, bad } = useBuilderForm(action);
  const nameError = bad.has('name')
    ? state.code === 'conflict'
      ? t('nameTaken')
      : t('nameInvalid')
    : undefined;
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="flex flex-col gap-5"
      noValidate
    >
      <fieldset
        className="m-0 flex flex-col gap-1 border-0 p-0"
        aria-describedby={bad.has('profile') ? 'profile-error' : undefined}
      >
        <legend className="pb-2 text-section">{t('profileLegend')}</legend>
        <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          {profiles.map((p, i) => (
            <Radio
              key={p.key}
              id={`profile-${p.key}`}
              name="profile"
              value={p.key}
              defaultChecked={i === 0}
              label={p.label}
              hint={t(`profileHelp.${p.key as 'other'}`)}
            />
          ))}
        </div>
        {bad.has('profile') ? (
          <p id="profile-error" className="text-caption text-danger">
            {t('profileInvalid')}
          </p>
        ) : null}
      </fieldset>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          id="template-name"
          name="name"
          required
          minLength={2}
          maxLength={120}
          label={t('name')}
          error={nameError}
        />
        <Input id="template-description" name="description" maxLength={500} label={t('description')} />
        <TimeZonePicker
          id="template-timezone"
          name="timezone"
          label={t('timezone')}
          hint={t('timezoneHint')}
          defaultValue={defaults.timezone}
        />
        <CurrencyPicker
          id="template-currency"
          name="currency"
          label={t('currency')}
          defaultValue={defaults.currency}
        />
        <DurationFields idPrefix="template" minutes={180} invalid={bad.has('duration')} />
      </div>
      <div aria-live="polite">
        <FormError state={state} handled={bad.size > 0} />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('create')}
      </Button>
    </form>
  );
}

export interface TemplateSettingsValues {
  readonly name: string;
  readonly description: string | null;
  readonly visibility: string;
  readonly timezone: string;
  readonly currency: string;
  readonly durationMinutes: number;
  readonly tagline: string | null;
  readonly venueName: string | null;
  readonly city: string | null;
}

/** Page content (tagline, venue, visibility) and the template's name and defaults: one Save. */
export function TemplateSettingsForm({
  action,
  values,
  visibilities,
  disabled,
}: {
  action: Action;
  values: TemplateSettingsValues;
  visibilities: readonly { value: string; label: string; text: string }[];
  disabled: boolean;
}) {
  const t = useTranslations('templateBuilder');
  const { state, formAction, pending, ref, bad } = useBuilderForm(action);
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="flex flex-col gap-6"
      noValidate
    >
      <fieldset
        id="content"
        aria-describedby="content-hint"
        className="m-0 flex scroll-mt-4 flex-col gap-4 border-0 p-0"
        disabled={disabled}
      >
        <legend className="pb-1 text-section">{t('contentTitle')}</legend>
        <p id="content-hint" className="-mt-2 text-body text-ink-2">
          {t('contentHint')}
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id="tpl-tagline"
            name="tagline"
            maxLength={280}
            defaultValue={values.tagline ?? ''}
            label={t('tagline')}
            className="md:col-span-2"
          />
          <Input
            id="tpl-venue"
            name="venueName"
            maxLength={160}
            defaultValue={values.venueName ?? ''}
            label={t('venueName')}
          />
          <Input
            id="tpl-city"
            name="city"
            maxLength={120}
            defaultValue={values.city ?? ''}
            label={t('city')}
          />
          <Select
            id="tpl-visibility"
            name="visibility"
            label={t('visibility')}
            defaultValue={values.visibility}
            options={visibilities}
            disabled={disabled}
          />
        </div>
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-4 border-0 p-0" disabled={disabled}>
        <legend className="pb-1 text-section">{t('settingsTitle')}</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id="tpl-name"
            name="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={values.name}
            label={t('name')}
            error={
              bad.has('name') ? (state.code === 'conflict' ? t('nameTaken') : t('nameInvalid')) : undefined
            }
          />
          <Input
            id="tpl-description"
            name="description"
            maxLength={500}
            defaultValue={values.description ?? ''}
            label={t('description')}
          />
          <TimeZonePicker
            id="tpl-timezone"
            name="timezone"
            label={t('timezone')}
            hint={t('timezoneHint')}
            defaultValue={values.timezone}
            disabled={disabled}
          />
          <CurrencyPicker
            id="tpl-currency"
            name="currency"
            label={t('currency')}
            defaultValue={values.currency}
            disabled={disabled}
          />
          <DurationFields idPrefix="tpl" minutes={values.durationMinutes} invalid={bad.has('duration')} />
        </div>
      </fieldset>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="success" title={t('saved')} /> : null}
        <FormError state={state} handled={bad.size > 0} />
      </div>
      {disabled ? null : (
        <Button type="submit" disabled={pending} className="self-start">
          {t('save')}
        </Button>
      )}
    </form>
  );
}

/** Add a default ticket type: name, price in the template's currency, quantity. */
export function TemplateTicketForm({ action, currency }: { action: Action; currency: string }) {
  const t = useTranslations('templateBuilder');
  const { state, formAction, pending, ref, bad } = useBuilderForm(action, true);
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
      noValidate
    >
      <Input
        id="ticket-name"
        name="name"
        required
        maxLength={120}
        label={t('ticketName')}
        error={bad.has('name') ? t('ticketNameInvalid') : undefined}
      />
      <Input id="ticket-description" name="description" maxLength={500} label={t('ticketDescription')} />
      <Input
        id="ticket-price"
        name="price"
        inputMode="decimal"
        defaultValue="0"
        label={t('price', { currency })}
        error={bad.has('price') ? t('priceInvalid') : undefined}
      />
      <Input
        id="ticket-quantity"
        name="quantity"
        type="number"
        inputMode="numeric"
        min={1}
        required
        label={t('quantity')}
        error={bad.has('quantity') ? t('quantityInvalid') : undefined}
      />
      <div aria-live="polite" className="flex flex-col gap-2 md:col-span-2">
        {state.ok && !pending ? <Alert tone="success" title={t('ticketAdded')} /> : null}
        <FormError state={state} handled={bad.size > 0} />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('addTicket')}
      </Button>
    </form>
  );
}

/** One line: a checklist item for the template (or, with `labels`, for an event). */
export function ChecklistItemForm({
  action,
  idPrefix,
  labels,
}: {
  action: Action;
  idPrefix: string;
  labels: { field: string; submit: string; added: string; invalid: string; tooMany: string };
}) {
  const { state, formAction, pending, ref, bad } = useBuilderForm(action, true);
  const tooMany = state.code === 'invalid_state';
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={keepValues(formAction)}
      className="flex flex-col gap-3"
      noValidate
    >
      <Input
        id={`${idPrefix}-title`}
        name="title"
        required
        maxLength={200}
        label={labels.field}
        error={bad.has('title') ? labels.invalid : tooMany ? labels.tooMany : undefined}
      />
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok && !pending ? <Alert tone="success" title={labels.added} /> : null}
        <FormError state={state} handled={bad.size > 0 || tooMany} />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {labels.submit}
      </Button>
    </form>
  );
}
