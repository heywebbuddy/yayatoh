'use client';

import { currencyExponent } from '@yayatoh/kernel';
import type { RefundPolicyDto } from '@yayatoh/orders';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
const KINDS = ['unset', 'none', 'until', 'always'] as const;

/** Set the event's refund policy (M1.6e): none, until N days before, or always, with a kept fee. */
export function RefundPolicyForm({
  action,
  policy,
  currency,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  policy: RefundPolicyDto | null;
  currency: string;
}) {
  const t = useTranslations('refundPolicy');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [kind, setKind] = useState<(typeof KINDS)[number]>(policy?.kind ?? 'unset');
  const bad = (f: string) => state.fields?.includes(f) ?? false;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-zinc-600">{t('kindLegend')}</legend>
        {KINDS.map((k) => (
          <label key={k} className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
              className="size-5"
            />
            {t(`kindOption.${k}`)}
          </label>
        ))}
      </fieldset>
      {kind === 'until' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="policy-days" className="text-caption text-zinc-600">
            {t('daysLabel')}
          </label>
          <input
            id="policy-days"
            name="daysBefore"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            required
            defaultValue={policy?.daysBefore ?? 7}
            aria-invalid={bad('daysBefore') || undefined}
            className={`${field} w-32`}
          />
          <p className="text-caption text-zinc-500">{t('daysHint')}</p>
        </div>
      ) : null}
      {kind === 'until' || kind === 'always' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="policy-retained" className="text-caption text-zinc-600">
            {t('retainedLabel', { currency })}
          </label>
          <input
            id="policy-retained"
            name="retained"
            inputMode="decimal"
            pattern="\d+([.,]\d{1,3})?"
            defaultValue={
              policy && policy.retainedMinor > 0
                ? (policy.retainedMinor / 10 ** currencyExponent(currency)).toFixed(
                    currencyExponent(currency),
                  )
                : ''
            }
            aria-invalid={bad('retainedMinor') || undefined}
            className={`${field} w-40`}
          />
          <p className="text-caption text-zinc-500">{t('retainedHint')}</p>
        </div>
      ) : null}
      <p className="text-caption text-zinc-500">{t('minimumHint')}</p>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('saved')} /> : null}
        {state.code ? (
          <Alert title={bad('daysBefore') ? t('daysInvalid') : te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('save')}
      </Button>
    </form>
  );
}
