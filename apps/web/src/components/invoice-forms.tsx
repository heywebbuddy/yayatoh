'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
const area = 'rounded-card border border-zinc-200 bg-white px-4 py-2 text-body';

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

function useInvoiceMessage() {
  const t = useTranslations('invoices');
  const te = useTranslations();
  return (s: FormState) =>
    s.reason && t.has(`errors.${s.reason}`)
      ? t(`errors.${s.reason}`)
      : s.fields?.[0] && t.has(`errors.field.${s.fields[0]}`)
        ? t(`errors.field.${s.fields[0]}`)
        : te(errorMessageKey(s.code));
}

/**
 * M5.1d finance: record a payment the organizer received for an invoice (check, wire, cash) with
 * its reference and the day it arrived. Idempotent per form (`key`): a double submit records once.
 */
export function RecordInvoicePaymentForm({
  action,
  currency,
  balance,
  balanceLabel,
  today,
  requestKey,
}: {
  action: Action;
  currency: string;
  /** The balance as a decimal ("600.00"), the amount's default. */
  balance: string;
  balanceLabel: string;
  today: string;
  requestKey: string;
}) {
  const t = useTranslations('invoices.record');
  const message = useInvoiceMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const bad = (f: string) => state.fields?.includes(f) || undefined;
  return (
    <form
      key={state.stamp ?? 0}
      action={formAction}
      aria-label={t('label')}
      className="flex flex-col gap-3"
      noValidate
    >
      <input type="hidden" name="key" value={requestKey} />
      <p className="text-caption text-zinc-600">{t('balance', { amount: balanceLabel })}</p>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invoice-pay-amount" className="text-caption text-zinc-600">
            {t('amount', { currency })}
          </label>
          <input
            id="invoice-pay-amount"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={balance}
            aria-invalid={bad('amount')}
            className={`${field} w-40`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invoice-pay-method" className="text-caption text-zinc-600">
            {t('method')}
          </label>
          <select id="invoice-pay-method" name="method" className={field} defaultValue="check">
            {(['check', 'wire', 'cash', 'other'] as const).map((m) => (
              <option key={m} value={m}>
                {t(`methods.${m}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invoice-pay-date" className="text-caption text-zinc-600">
            {t('receivedOn')}
          </label>
          <input
            id="invoice-pay-date"
            name="receivedOn"
            type="date"
            required
            max={today}
            defaultValue={today}
            aria-invalid={bad('receivedOn')}
            className={field}
          />
        </div>
      </div>
      <Input
        id="invoice-pay-reference"
        name="reference"
        maxLength={80}
        autoComplete="off"
        label={t('reference')}
        hint={t('referenceHint')}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invoice-pay-note" className="text-caption text-zinc-600">
          {t('note')}
        </label>
        <textarea id="invoice-pay-note" name="note" rows={2} maxLength={500} className={area} />
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok ? <Alert tone="info" title={t('recorded')} /> : null}
        {state.code ? <Alert title={message(state)} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}

/** M5.1d finance: void an unpaid invoice, with the reason (audited). */
export function VoidInvoiceForm({ action }: { action: Action }) {
  const t = useTranslations('invoices.void');
  const message = useInvoiceMessage();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} aria-label={t('label')} className="flex flex-col gap-3" noValidate>
      <p className="text-caption text-zinc-600">{t('hint')}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invoice-void-reason" className="text-caption text-zinc-600">
          {t('reason')}
        </label>
        <textarea
          id="invoice-void-reason"
          name="reason"
          rows={2}
          maxLength={500}
          required
          aria-invalid={state.fields?.includes('reason') || undefined}
          className={area}
        />
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.ok ? <Alert tone="info" title={t('done')} /> : null}
        {state.code ? <Alert title={message(state)} /> : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
