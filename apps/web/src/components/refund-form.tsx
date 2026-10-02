'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { RefundState } from '@/app/[locale]/o/[org]/e/[event]/orders/[orderId]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUpActionState } from './step-up.tsx';

const REASONS = [
  'requested_by_customer',
  'event_cancelled',
  'event_postponed',
  'duplicate',
  'fraudulent',
  'goodwill',
] as const;

const field = 'field';

/** Refund whole tickets (voided) or an amount; the fee follows the refund policy. */
export function RefundForm({
  action,
  tickets,
  currency,
  timeZone,
  canOverride = false,
}: {
  action: (prev: RefundState, form: FormData) => Promise<RefundState>;
  tickets: readonly { id: string; label: string }[];
  currency: string;
  /** The event's timezone: refund-policy deadlines are shown in it. */
  timeZone: string;
  /** Owners and admins may refund outside the event's refund policy, with a note (M1.6e). */
  canOverride?: boolean;
}) {
  const t = useTranslations('refunds');
  const te = useTranslations();
  // Large refunds (or the whole order) need a recent step-up (M1.2c).
  const [state, formAction, pending, formRef] = useStepUpActionState(action, { ok: false, code: null });
  const [mode, setMode] = useState<'tickets' | 'amount'>(tickets.length ? 'tickets' : 'amount');
  const [override, setOverride] = useState(false);
  const locale = useLocale();
  const deadline = state.deadline
    ? new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
        timeZoneName: 'short',
      }).format(new Date(state.deadline))
    : '';
  const error =
    state.code === null
      ? null
      : state.code === 'refund_failed'
        ? t('failed')
        : state.reason === 'exceeds_refundable'
          ? t('exceedsRefundable')
          : state.reason === 'ticket_refunded'
            ? t('ticketRefunded')
            : state.reason === 'policy_window_closed'
              ? t('policyWindowClosed', { deadline })
              : state.reason === 'policy_no_refunds'
                ? t('policyNoRefunds')
                : state.field === 'note'
                  ? t('overrideNoteRequired')
                  : te(errorMessageKey(state.code));
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="refund-reason" className="text-[13px] font-bold text-ink">
          {t('reason')}
        </label>
        <select id="refund-reason" name="reason" className={field} defaultValue="requested_by_customer">
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reasons.${r}`)}
            </option>
          ))}
        </select>
        <p className="text-caption text-ink-2">{t('feePolicy')}</p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-bold text-ink">{t('what')}</legend>
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input
            type="radio"
            name="mode"
            value="tickets"
            checked={mode === 'tickets'}
            disabled={tickets.length === 0}
            onChange={() => setMode('tickets')}
            className="size-5"
          />
          {t('modeTickets')}
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
          {t('modeAmount')}
        </label>
      </fieldset>
      {mode === 'tickets' ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[13px] font-bold text-ink">{t('tickets')}</legend>
          {tickets.map((tk) => (
            <label key={tk.id} className="flex min-h-6 items-center gap-2 text-body">
              <input type="checkbox" name="ticket" value={tk.id} className="size-5" />
              {tk.label}
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="refund-amount" className="text-[13px] font-bold text-ink">
            {t('amount', { currency })}
          </label>
          <input
            id="refund-amount"
            name="amount"
            inputMode="decimal"
            required
            pattern="\d+([.,]\d{1,3})?"
            className={`${field} w-40`}
          />
        </div>
      )}
      {canOverride ? (
        <label className="flex min-h-6 items-start gap-2 text-body">
          <input
            type="checkbox"
            name="override"
            value="yes"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            className="mt-0.5 size-5 shrink-0"
          />
          <span className="flex flex-col">
            <span>{t('override')}</span>
            <span className="text-caption text-ink-2">{t('overrideHint')}</span>
          </span>
        </label>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="refund-note" className="text-[13px] font-bold text-ink">
          {override ? t('overrideNote') : t('note')}
        </label>
        <input
          id="refund-note"
          name="note"
          maxLength={500}
          required={override}
          minLength={override ? 3 : undefined}
          aria-invalid={state.field === 'note' || undefined}
          className={field}
        />
      </div>
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('done')} /> : null}
        {error ? <Alert title={error} /> : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
