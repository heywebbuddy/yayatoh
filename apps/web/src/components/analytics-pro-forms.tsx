'use client';

import { Alert, Button, Card, Checkbox, Input, Select, Switch } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/**
 * M6.2b client forms (the explorer's saved views, alert rules, scheduled reports). Each one posts
 * to a Server Action that runs the module's command; validation comes back as the form state and
 * is shown next to its field (`aria-invalid`, described by the message), anything else in a
 * polite alert. Success navigates (the page announces it). Built only from v2 `@yayatoh/ui`.
 */
type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/**
 * Submit through the action without React's automatic form reset, so what was typed stays when
 * the server says something needs fixing (success navigates away instead).
 */
function keepValues(dispatch: (form: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => dispatch(form));
  };
}

const has = (s: FormState, field: string) => !s.ok && (s.fields ?? []).includes(field);

function GeneralError({ state, known }: { state: FormState; known: readonly string[] }) {
  const te = useTranslations();
  if (state.ok || !state.code) return null;
  if ((state.fields ?? []).length > 0) return null;
  if (state.reason && known.includes(state.reason)) return null;
  return <Alert title={te(errorMessageKey(state.code))} />;
}

/** One-button form for a row action (delete, turn off or on). */
export function RowActionForm({
  action,
  fields,
  label,
  ariaLabel,
  testId,
  variant = 'secondary',
}: {
  action: Action;
  fields: Readonly<Record<string, string>>;
  label: string;
  ariaLabel: string;
  testId?: string;
  variant?: 'secondary' | 'ghost' | 'danger';
}) {
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button
        type="submit"
        size="sm"
        variant={variant}
        disabled={pending}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        {label}
      </Button>
      <span aria-live="polite" className="text-caption text-danger">
        {!state.ok && state.code ? te(errorMessageKey(state.code)) : ''}
      </span>
    </form>
  );
}

/** Save the explorer's current choice as a named view (the choice travels in hidden fields). */
export function SaveViewForm({ action, view }: { action: Action; view: Readonly<Record<string, string>> }) {
  const t = useTranslations('analyticsPro.explore');
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const nameError =
    state.reason === 'name_taken'
      ? t('viewErrors.name_taken')
      : has(state, 'name')
        ? t('viewErrors.name')
        : undefined;
  return (
    <form
      action={formAction}
      onSubmit={keepValues(formAction)}
      noValidate
      className="flex flex-col gap-3"
      aria-labelledby="save-view-heading"
    >
      <h2 id="save-view-heading" className="text-section">
        {t('saveTitle')}
      </h2>
      {Object.entries(view).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 grow sm:grow-0">
          <Input
            id="view-name"
            name="name"
            maxLength={80}
            autoComplete="off"
            label={t('viewName')}
            error={nameError}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={pending} data-testid="save-view">
          {t('save')}
        </Button>
      </div>
      <div aria-live="polite">
        {state.reason === 'too_many_views' ? <Alert title={t('viewErrors.too_many_views')} /> : null}
        <GeneralError state={state} known={['name_taken', 'too_many_views']} />
      </div>
    </form>
  );
}

export interface RuleInitial {
  readonly name: string;
  readonly measure: string;
  readonly condition: string;
  /** As typed: whole number, or an amount in major units for money. */
  readonly threshold: string;
  readonly windowDays: number;
  readonly currency: string;
  readonly eventId: string;
  readonly severity: string;
  readonly quietHours: boolean;
}

export function AlertRuleForm({
  action,
  initial,
  measures,
  moneyMeasures,
  events,
  currencies,
  mode,
}: {
  action: Action;
  initial?: RuleInitial;
  measures: readonly string[];
  moneyMeasures: readonly string[];
  events: readonly { id: string; name: string }[];
  currencies: readonly string[];
  mode: 'create' | 'edit';
}) {
  const t = useTranslations('analyticsPro.rules');
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const nameError =
    state.reason === 'name_taken'
      ? t('errors.name_taken')
      : has(state, 'name')
        ? t('errors.name')
        : undefined;
  const thresholdError =
    state.reason === 'percent_range'
      ? t('errors.percent_range')
      : has(state, 'threshold')
        ? t('errors.threshold')
        : undefined;
  const currencyError = state.reason === 'currency_required' ? t('errors.currency_required') : undefined;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-section">{mode === 'create' ? t('createTitle') : t('editTitle')}</h2>
      <form
        action={formAction}
        onSubmit={keepValues(formAction)}
        noValidate
        className="flex flex-col gap-4"
        data-testid="alert-rule-form"
      >
        <Input
          id="rule-name"
          name="name"
          maxLength={80}
          autoComplete="off"
          label={t('name')}
          hint={t('nameHint')}
          defaultValue={initial?.name}
          error={nameError}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="rule-measure"
            name="measure"
            label={t('measure')}
            defaultValue={initial?.measure ?? measures[0]}
          >
            {measures.map((m) => (
              <option key={m} value={m}>
                {t(`measures.${m}` as 'measures.registrations')}
              </option>
            ))}
          </Select>
          <Select
            id="rule-condition"
            name="condition"
            label={t('condition')}
            defaultValue={initial?.condition ?? 'above'}
          >
            {(['above', 'below', 'rise', 'drop'] as const).map((c) => (
              <option key={c} value={c}>
                {t(`conditions.${c}`)}
              </option>
            ))}
          </Select>
          <Input
            id="rule-threshold"
            name="threshold"
            inputMode="decimal"
            autoComplete="off"
            label={t('threshold')}
            hint={t('thresholdHint')}
            defaultValue={initial?.threshold}
            error={thresholdError}
          />
          <Select
            id="rule-window"
            name="windowDays"
            label={t('window')}
            defaultValue={String(initial?.windowDays ?? 1)}
          >
            {([1, 7, 14, 30] as const).map((w) => (
              <option key={w} value={String(w)}>
                {t(`windows.d${w}`)}
              </option>
            ))}
          </Select>
          {moneyMeasures.length ? (
            <Select
              id="rule-currency"
              name="currency"
              label={t('currency')}
              hint={currencyError ? undefined : t('currencyHint')}
              error={currencyError}
              defaultValue={initial?.currency ?? ''}
            >
              <option value="">{t('noCurrency')}</option>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          ) : null}
          <Select id="rule-event" name="eventId" label={t('event')} defaultValue={initial?.eventId ?? ''}>
            <option value="">{t('allEvents')}</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <Select
            id="rule-severity"
            name="severity"
            label={t('severity')}
            defaultValue={initial?.severity ?? 'warning'}
          >
            {(['info', 'warning', 'critical'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`severities.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <Switch
          id="rule-quiet"
          name="quietHours"
          value="1"
          label={t('quietHours')}
          hint={t('quietHoursHint')}
          defaultChecked={initial?.quietHours ?? true}
        />
        <div>
          <Button type="submit" disabled={pending} data-testid="alert-rule-submit">
            {mode === 'create' ? t('create') : t('save')}
          </Button>
        </div>
        <div aria-live="polite">
          {state.reason === 'too_many_rules' ? <Alert title={t('errors.too_many_rules')} /> : null}
          <GeneralError
            state={state}
            known={['name_taken', 'percent_range', 'currency_required', 'too_many_rules']}
          />
        </div>
      </form>
    </Card>
  );
}

export interface ScheduleInitial {
  readonly name: string;
  readonly frequency: string;
  readonly sendHour: number;
  readonly eventId: string;
  readonly recipients: readonly string[];
}

export function ReportScheduleForm({
  action,
  initial,
  events,
  members,
  hours,
  timeZone,
  mode,
}: {
  action: Action;
  initial?: ScheduleInitial;
  events: readonly { id: string; name: string }[];
  members: readonly { id: string; label: string }[];
  /** Labels of the hours 0–23 in the viewer's locale. */
  hours: readonly string[];
  timeZone: string;
  mode: 'create' | 'edit';
}) {
  const t = useTranslations('analyticsPro.reports');
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const nameError =
    state.reason === 'name_taken'
      ? t('errors.name_taken')
      : has(state, 'name')
        ? t('errors.name')
        : undefined;
  const recipientsError =
    state.reason === 'bad_recipient'
      ? t('errors.bad_recipient')
      : has(state, 'recipients')
        ? t('errors.recipients')
        : undefined;
  const chosen = new Set(initial?.recipients ?? []);
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-section">{mode === 'create' ? t('createTitle') : t('editTitle')}</h2>
      <form
        action={formAction}
        onSubmit={keepValues(formAction)}
        noValidate
        className="flex flex-col gap-4"
        data-testid="report-schedule-form"
      >
        <Input
          id="schedule-name"
          name="name"
          maxLength={80}
          autoComplete="off"
          label={t('name')}
          defaultValue={initial?.name}
          error={nameError}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="schedule-frequency"
            name="frequency"
            label={t('frequency')}
            defaultValue={initial?.frequency ?? 'weekly'}
          >
            {(['daily', 'weekly', 'monthly'] as const).map((f) => (
              <option key={f} value={f}>
                {t(`frequencies.${f}`)}
              </option>
            ))}
          </Select>
          <Select
            id="schedule-hour"
            name="sendHour"
            label={t('sendHour')}
            hint={t('sendHourHint', { timeZone })}
            defaultValue={String(initial?.sendHour ?? 8)}
          >
            {hours.map((h, i) => (
              <option key={h} value={String(i)}>
                {h}
              </option>
            ))}
          </Select>
          <Select id="schedule-event" name="eventId" label={t('event')} defaultValue={initial?.eventId ?? ''}>
            <option value="">{t('allEvents')}</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </div>
        <fieldset
          className="flex flex-col gap-1"
          aria-describedby={recipientsError ? 'recipients-error' : 'recipients-hint'}
          aria-invalid={recipientsError ? true : undefined}
        >
          <legend className="text-[13px] font-bold text-ink">{t('recipients')}</legend>
          <p id="recipients-hint" className="text-caption text-ink-2">
            {t('recipientsHint')}
          </p>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {members.map((m) => (
              <Checkbox
                key={m.id}
                id={`recipient-${m.id}`}
                name="recipients"
                value={m.id}
                label={m.label}
                defaultChecked={chosen.has(m.id)}
              />
            ))}
          </div>
          {recipientsError ? (
            <p id="recipients-error" className="text-caption font-semibold text-danger">
              {recipientsError}
            </p>
          ) : null}
        </fieldset>
        <div>
          <Button type="submit" disabled={pending} data-testid="report-schedule-submit">
            {mode === 'create' ? t('create') : t('save')}
          </Button>
        </div>
        <div aria-live="polite">
          {state.reason === 'too_many_schedules' ? <Alert title={t('errors.too_many_schedules')} /> : null}
          <GeneralError state={state} known={['name_taken', 'bad_recipient', 'too_many_schedules']} />
        </div>
      </form>
    </Card>
  );
}
