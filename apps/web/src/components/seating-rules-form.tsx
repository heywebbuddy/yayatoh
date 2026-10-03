'use client';

import type { SeatingRule } from '@yayatoh/seating/client';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState } from 'react';
import type { RulesState } from '@/app/[locale]/o/[org]/e/[event]/seating/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const field = 'field w-24';

/**
 * The event's seating rules (M1.7f): accessible seats kept back until some days before the
 * event, and a cap on seats per order. Each one warns (recommended, decision D18) or is enforced.
 * The server checks the numbers; a refused value is marked and explained.
 */
export function SeatingRulesForm({
  rules,
  companions = false,
  action,
}: {
  rules: readonly SeatingRule[];
  /** M6.11a: the org has advanced seating, so the companion-seat rule can be set. */
  companions?: boolean;
  action: (prev: RulesState, form: FormData) => Promise<RulesState>;
}) {
  const t = useTranslations('seating.rules');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const ada = rules.find((r) => r.kind === 'ada_reserved');
  const cap = rules.find((r) => r.kind === 'max_per_order_seats');
  const companion = rules.find((r) => r.kind === 'ada_companion');
  // Keep what was typed when the server refuses a value.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
  const severity = (name: string, current: 'warn' | 'enforce' | undefined) => (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-bold text-ink">{t('severity')}</legend>
      {(['warn', 'enforce'] as const).map((s) => (
        <div key={s} className="flex flex-col gap-0.5">
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="radio"
              name={name}
              value={s}
              defaultChecked={(current ?? 'warn') === s}
              className="size-5"
              aria-describedby={`${name}-${s}-hint`}
            />
            {t(`severityOption.${s}`)}
          </label>
          <p id={`${name}-${s}-hint`} className="ps-7 text-caption text-ink-2">
            {t(`severityHint.${s}`)}
          </p>
        </div>
      ))}
    </fieldset>
  );
  const invalid = (f: 'adaDays' | 'capMax' | 'companionMax') => state.field === f;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('ada.title')}</legend>
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input type="checkbox" name="ada" defaultChecked={Boolean(ada)} className="size-5" />
          {t('ada.on')}
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rules-ada-days" className="text-[13px] font-bold text-ink">
            {t('ada.days')}
          </label>
          <input
            id="rules-ada-days"
            name="adaDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            defaultValue={ada?.kind === 'ada_reserved' ? ada.params.releaseDays : 7}
            aria-invalid={invalid('adaDays') || undefined}
            aria-describedby={invalid('adaDays') ? 'rules-ada-days-error' : 'rules-ada-days-hint'}
            className={field}
          />
          {invalid('adaDays') ? (
            <p id="rules-ada-days-error" className="text-caption font-medium text-danger">
              {t('ada.daysError')}
            </p>
          ) : (
            <p id="rules-ada-days-hint" className="text-caption text-ink-2">
              {t('ada.daysHint')}
            </p>
          )}
        </div>
        {severity('adaSeverity', ada?.severity)}
      </fieldset>

      {companions ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-body font-medium">{t('companion.title')}</legend>
          <input type="hidden" name="companionShown" value="1" />
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input type="checkbox" name="companion" defaultChecked={Boolean(companion)} className="size-5" />
            {t('companion.on')}
          </label>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rules-companion-max" className="text-caption text-ink-2">
              {t('companion.max')}
            </label>
            <input
              id="rules-companion-max"
              name="companionMax"
              type="number"
              inputMode="numeric"
              min={1}
              max={3}
              defaultValue={companion?.kind === 'ada_companion' ? companion.params.maxPerAccessible : 1}
              aria-invalid={invalid('companionMax') || undefined}
              aria-describedby={
                invalid('companionMax') ? 'rules-companion-max-error' : 'rules-companion-max-hint'
              }
              className={field}
            />
            {invalid('companionMax') ? (
              <p id="rules-companion-max-error" className="text-caption font-medium text-danger">
                {t('companion.maxError')}
              </p>
            ) : (
              <p id="rules-companion-max-hint" className="text-caption text-ink-2">
                {t('companion.maxHint')}
              </p>
            )}
          </div>
          {severity('companionSeverity', companion?.severity)}
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('cap.title')}</legend>
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input type="checkbox" name="cap" defaultChecked={Boolean(cap)} className="size-5" />
          {t('cap.on')}
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="rules-cap-max" className="text-[13px] font-bold text-ink">
            {t('cap.max')}
          </label>
          <input
            id="rules-cap-max"
            name="capMax"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            defaultValue={cap?.kind === 'max_per_order_seats' ? cap.params.max : 10}
            aria-invalid={invalid('capMax') || undefined}
            aria-describedby={invalid('capMax') ? 'rules-cap-max-error' : undefined}
            className={field}
          />
          {invalid('capMax') ? (
            <p id="rules-cap-max-error" className="text-caption font-medium text-danger">
              {t('cap.maxError')}
            </p>
          ) : null}
        </div>
        {severity('capSeverity', cap?.severity)}
      </fieldset>

      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code && !state.field ? (
          <Alert title={state.code === 'forbidden' ? t('forbidden') : te(errorMessageKey(state.code))} />
        ) : null}
        {state.field ? <Alert title={t('fixErrors')} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('save')}
      </Button>
    </form>
  );
}
