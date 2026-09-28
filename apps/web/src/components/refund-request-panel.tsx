'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { useStepUpActionState } from './step-up.tsx';

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

/**
 * Answer a buyer's refund request (M3.10b): approve (the tickets they asked for, or an amount) or
 * decline with a reason the buyer is emailed. Approving is a refund: large ones ask for a step-up.
 */
export function RefundRequestPanel({
  approve,
  decline,
  currency,
}: {
  approve: (prev: FormState, form: FormData) => Promise<FormState>;
  decline: (prev: FormState, form: FormData) => Promise<FormState>;
  currency: string;
}) {
  const t = useTranslations('refundOps.request');
  const te = useTranslations();
  const [mode, setMode] = useState<'tickets' | 'amount'>('tickets');
  const [approved, approveAction, approving, approveRef] = useStepUpActionState(approve, INITIAL_FORM_STATE);
  const [declined, declineAction, declining] = useActionState(decline, INITIAL_FORM_STATE);
  const message = (s: FormState) =>
    s.code === 'refund_failed'
      ? te('refunds.failed')
      : s.reason === 'request_answered'
        ? t('answered')
        : s.reason === 'exceeds_refundable'
          ? te('refunds.exceedsRefundable')
          : s.reason === 'ticket_refunded'
            ? te('refunds.ticketRefunded')
            : s.fields?.includes('reason')
              ? t('reasonInvalid')
              : te(errorMessageKey(s.code));
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <form ref={approveRef} action={approveAction} className="flex flex-1 flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-section">{t('approveLegend')}</legend>
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="radio"
              name="mode"
              value="tickets"
              checked={mode === 'tickets'}
              onChange={() => setMode('tickets')}
              className="size-5"
            />
            {t('approveFull')}
          </label>
          <label className="flex min-h-6 items-center gap-2 text-body">
            <input
              type="radio"
              name="mode"
              value="amount"
              checked={mode === 'amount'}
              onChange={() => setMode('amount')}
              className="size-5"
            />
            {t('approvePartial')}
          </label>
        </fieldset>
        {mode === 'amount' ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="request-amount" className="text-caption text-zinc-600">
              {t('amount', { currency })}
            </label>
            <input
              id="request-amount"
              name="amount"
              inputMode="decimal"
              required
              pattern="\d+([.,]\d{1,3})?"
              aria-invalid={approved.fields?.includes('amountMinor') || undefined}
              className={`${field} w-40`}
            />
          </div>
        ) : null}
        <div aria-live="polite">
          {approved.ok ? <Alert tone="info" title={t('approved')} /> : null}
          {approved.code ? <Alert title={message(approved)} /> : null}
        </div>
        <Button type="submit" disabled={approving} className="self-start">
          {t('approve')}
        </Button>
      </form>
      <form action={declineAction} className="flex flex-1 flex-col gap-3">
        <h3 className="text-section">{t('declineLegend')}</h3>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="request-decline-reason" className="text-caption text-zinc-600">
            {t('reason')}
          </label>
          <textarea
            id="request-decline-reason"
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={3}
            aria-invalid={declined.fields?.includes('reason') || undefined}
            aria-describedby="request-decline-hint"
            className="rounded-card border border-zinc-200 bg-white px-4 py-2 text-body"
          />
          <p id="request-decline-hint" className="text-caption text-zinc-500">
            {t('reasonHint')}
          </p>
        </div>
        <div aria-live="polite">
          {declined.ok ? <Alert tone="info" title={t('declined')} /> : null}
          {declined.code ? <Alert title={message(declined)} /> : null}
        </div>
        <Button type="submit" variant="secondary" disabled={declining} className="self-start">
          {t('decline')}
        </Button>
      </form>
    </div>
  );
}

/** Add an internal note to an order (M3.10b): the team's support context on the timeline. */
export function OrderNoteForm({
  action,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = useTranslations('refundOps.notes');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form key={state.stamp ?? 0} action={formAction} className="flex flex-col gap-2">
      <label htmlFor="order-note" className="text-caption text-zinc-600">
        {t('label')}
      </label>
      <textarea
        id="order-note"
        name="body"
        required
        maxLength={2000}
        rows={2}
        aria-describedby="order-note-hint"
        aria-invalid={state.fields?.includes('body') || undefined}
        className="rounded-card border border-zinc-200 bg-white px-4 py-2 text-body"
      />
      <p id="order-note-hint" className="text-caption text-zinc-500">
        {t('hint')}
      </p>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('added')} /> : null}
        {state.code ? (
          <Alert title={state.fields?.includes('body') ? t('invalid') : te(errorMessageKey(state.code))} />
        ) : null}
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {t('add')}
      </Button>
    </form>
  );
}
