'use client';

import { currencyExponent } from '@yayatoh/kernel';
import type { RefundPolicyDto } from '@yayatoh/orders';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { RefundPolicyFormState } from '@/app/[locale]/o/[org]/e/[event]/tickets-orders/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { INITIAL_FORM_STATE } from '@/lib/form-state.ts';

const field = 'field';
const KINDS = ['unset', 'none', 'until', 'always'] as const;

/** Set the event's refund policy (M1.6e): none, until N days before, or always, with a kept fee. */
export function RefundPolicyForm({
  action,
  policy,
  currency,
}: {
  action: (prev: RefundPolicyFormState, form: FormData) => Promise<RefundPolicyFormState>;
  policy: RefundPolicyDto | null;
  currency: string;
}) {
  const t = useTranslations('refundPolicy');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE as RefundPolicyFormState);
  const tr = useTranslations('refundOps.policy');
  const [kind, setKind] = useState<(typeof KINDS)[number]>(policy?.kind ?? 'unset');
  const bad = (f: string) => state.fields?.includes(f) ?? false;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-bold text-ink">{t('kindLegend')}</legend>
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
          <label htmlFor="policy-days" className="text-[13px] font-bold text-ink">
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
          <p className="text-caption text-ink-2">{t('daysHint')}</p>
        </div>
      ) : null}
      {kind === 'until' || kind === 'always' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="policy-retained" className="text-[13px] font-bold text-ink">
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
          <p className="text-caption text-ink-2">{t('retainedHint')}</p>
        </div>
      ) : null}
      <p className="text-caption text-ink-2">{t('minimumHint')}</p>
      <p className="text-caption text-ink-2">{tr('tightenHint')}</p>
      <div aria-live="polite">
        {state.ok ? (
          <Alert
            tone="info"
            title={
              typeof state.keptTerms === 'number' ? tr('tightened', { count: state.keptTerms }) : t('saved')
            }
          />
        ) : null}
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
