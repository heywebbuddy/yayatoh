'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/**
 * The buyer pays all or part of an invoice (M5.1d): the amount (the balance by default), then the
 * payment page. The Idempotency-Key is minted with the page, so submitting twice pays once.
 */
export function InvoicePayForm({
  action,
  currency,
  balance,
  requestKey,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  currency: string;
  balance: string;
  requestKey: string;
}) {
  const t = useTranslations('invoices.public');
  const te = useTranslations();
  const ti = useTranslations('invoices');
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const bad = state.fields?.includes('amount') || state.reason?.startsWith('amount') || undefined;
  const message =
    state.code === 'rate_limited'
      ? te('errors.rateLimitedRetry', { minutes: Number(state.reason) || 1 })
      : state.reason && ti.has(`errors.${state.reason}`)
        ? ti(`errors.${state.reason}`)
        : te(errorMessageKey(state.code));
  return (
    <form action={formAction} aria-label={t('payLabel')} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="key" value={requestKey} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invoice-amount" className="text-caption text-zinc-600">
          {t('amount', { currency })}
        </label>
        <input
          id="invoice-amount"
          name="amount"
          inputMode="decimal"
          required
          defaultValue={balance}
          aria-describedby="invoice-amount-hint"
          aria-invalid={bad}
          className="min-h-11 w-full max-w-60 rounded-pill border border-zinc-300 bg-white px-4 text-body"
        />
        <p id="invoice-amount-hint" className="text-caption text-zinc-500">
          {t('amountHint')}
        </p>
      </div>
      <div aria-live="assertive">{state.code ? <Alert title={message} /> : null}</div>
      <Button type="submit" disabled={pending} className="min-h-11 self-start">
        {t('pay')}
      </Button>
    </form>
  );
}
