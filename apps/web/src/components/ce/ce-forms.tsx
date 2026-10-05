'use client';

import { Alert, Button, Checkbox, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useId } from 'react';
import type { CalculationState } from '@/app/[locale]/o/[org]/e/[event]/ce-credits/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

type Save = (prev: FormState, form: FormData) => Promise<FormState>;
type Act = (prev: FormState) => Promise<FormState>;

/** Refusal reasons with their own message (`ce.errors.*`); others use the generic code's. */
const CE_REASONS = ['in_person_event'] as const;
const known = (r: string | undefined): r is (typeof CE_REASONS)[number] =>
  !!r && (CE_REASONS as readonly string[]).includes(r);

function Outcome({ state, saved }: { state: FormState; saved: string }) {
  const te = useTranslations();
  return (
    <div aria-live="polite">
      {state.ok && saved ? <Alert tone="success" title={saved} /> : null}
      {state.code ? (
        <Alert
          title={te(
            known(state.reason)
              ? `ce.errors.${state.reason}`
              : state.code === 'validation_failed'
                ? 'ce.setup.fixFields'
                : errorMessageKey(state.code),
          )}
        />
      ) : null}
    </div>
  );
}

const has = (s: FormState, f: string) => !s.ok && (s.fields ?? []).includes(f);

/** The credit's name and the accrediting body printed on the certificates. */
export function SettingsForm({
  creditLabel,
  accreditor,
  canEdit,
  save,
}: {
  creditLabel: string | null;
  accreditor: string | null;
  canEdit: boolean;
  save: Save;
}) {
  const t = useTranslations('ce.setup');
  const id = useId();
  const [state, action, pending] = useActionState(save, INITIAL_FORM_STATE);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate aria-label={t('settingsTitle')}>
      <fieldset className="m-0 flex flex-col gap-4 border-0 p-0" disabled={!canEdit}>
        <Input
          id={`${id}-label`}
          name="creditLabel"
          label={t('creditLabel')}
          hint={t('creditLabelHint')}
          defaultValue={creditLabel ?? ''}
          maxLength={80}
          error={has(state, 'creditLabel') ? t('creditLabelTooLong') : undefined}
        />
        <Input
          id={`${id}-accreditor`}
          name="accreditor"
          label={t('accreditor')}
          hint={t('accreditorHint')}
          defaultValue={accreditor ?? ''}
          maxLength={140}
          error={has(state, 'accreditor') ? t('accreditorTooLong') : undefined}
        />
      </fieldset>
      {canEdit ? (
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('saveSettings')}
          </Button>
        </div>
      ) : null}
      <Outcome state={state} saved={t('settingsSaved')} />
    </form>
  );
}

/** One session's credit rule: credits, minimum minutes, which attendance counts. */
export function RuleForm({
  title,
  credits,
  minMinutes,
  countInPerson,
  countVirtual,
  hasRule,
  canEdit,
  save,
  remove,
}: {
  title: string;
  /** "1.5" (the locale's own digits are accepted too). */
  credits: string;
  minMinutes: number | null;
  countInPerson: boolean;
  countVirtual: boolean;
  hasRule: boolean;
  canEdit: boolean;
  save: Save;
  remove: Act;
}) {
  const t = useTranslations('ce.setup');
  const id = useId();
  const [state, action, pending] = useActionState(save, INITIAL_FORM_STATE);
  const [removed, removeAction, removing] = useActionState(remove, INITIAL_FORM_STATE);
  return (
    <form
      action={action}
      className="flex flex-col gap-3"
      noValidate
      aria-label={t('ruleFormLabel', { title })}
    >
      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0" disabled={!canEdit}>
        <legend className="sr-only">{t('ruleFormLabel', { title })}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            id={`${id}-credits`}
            name="credits"
            inputMode="decimal"
            label={t('credits')}
            hint={t('creditsHint')}
            defaultValue={credits}
            error={has(state, 'credits') ? t('creditsInvalid') : undefined}
          />
          <Input
            id={`${id}-minutes`}
            name="minMinutes"
            inputMode="numeric"
            label={t('minMinutes')}
            hint={t('minMinutesHint')}
            defaultValue={minMinutes === null ? '' : String(minMinutes)}
            error={has(state, 'minMinutes') ? t('minMinutesInvalid') : undefined}
          />
        </div>
        <fieldset className="m-0 flex flex-col border-0 p-0">
          <legend className="p-0 text-body font-semibold">{t('counts')}</legend>
          <div className="flex flex-col sm:flex-row sm:gap-6">
            <Checkbox
              id={`${id}-in-person`}
              name="countInPerson"
              defaultChecked={countInPerson}
              label={t('countInPerson')}
            />
            <Checkbox
              id={`${id}-online`}
              name="countVirtual"
              defaultChecked={countVirtual}
              label={t('countVirtual')}
            />
          </div>
          {has(state, 'countInPerson') ? (
            <p className="m-0 text-caption font-semibold text-danger">{t('countsInvalid')}</p>
          ) : null}
        </fieldset>
      </fieldset>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={pending}
            aria-label={t('saveRuleLabel', { title })}
          >
            {t('saveRule')}
          </Button>
          {hasRule ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={removing}
              aria-label={t('removeRuleLabel', { title })}
              onClick={() => startTransition(() => removeAction())}
            >
              {t('removeRule')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Outcome state={state} saved={t('ruleSaved', { title })} />
      <Outcome state={removed} saved={t('ruleRemoved', { title })} />
    </form>
  );
}

/** The one primary action: calculate credits and issue certificates. */
export function CalculateForm({
  canEdit,
  disabled,
  calculate,
}: {
  canEdit: boolean;
  disabled: boolean;
  calculate: (prev: CalculationState) => Promise<CalculationState>;
}) {
  const t = useTranslations('ce.setup');
  const [state, action, pending] = useActionState(calculate, INITIAL_FORM_STATE as CalculationState);
  if (!canEdit) return null;
  const r = state.result;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" disabled={pending || disabled} onClick={() => startTransition(() => action())}>
          {t('calculate')}
        </Button>
      </div>
      <div aria-live="polite">
        {r ? (
          <Alert tone="success" title={t('calculated')}>
            <span data-testid="ce-result">
              {t('calculatedSummary', {
                issued: r.issued,
                revised: r.revised,
                revoked: r.revoked,
                unchanged: r.unchanged,
              })}{' '}
              {r.below ? t('calculatedBelow', { count: r.below }) : null}{' '}
              {r.pendingSessions ? t('calculatedPending', { count: r.pendingSessions }) : null}
            </span>
          </Alert>
        ) : null}
        {state.code ? <Outcome state={state} saved="" /> : null}
      </div>
    </div>
  );
}
