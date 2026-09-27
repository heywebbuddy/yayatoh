'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { RefundState } from '@/app/[locale]/o/[org]/e/[event]/orders/[orderId]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

const REASONS = [
  'requested_by_customer',
  'event_cancelled',
  'event_postponed',
  'duplicate',
  'fraudulent',
  'goodwill',
] as const;

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

/** Refund whole tickets (voided) or an amount; the fee follows the refund policy. */
export function RefundForm({
  action,
  tickets,
  currency,
}: {
  action: (prev: RefundState, form: FormData) => Promise<RefundState>;
  tickets: readonly { id: string; label: string }[];
  currency: string;
}) {
  const t = useTranslations('refunds');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const [mode, setMode] = useState<'tickets' | 'amount'>(tickets.length ? 'tickets' : 'amount');
  const error =
    state.code === null
      ? null
      : state.code === 'refund_failed'
        ? t('failed')
        : state.reason === 'exceeds_refundable'
          ? t('exceedsRefundable')
          : state.reason === 'ticket_refunded'
            ? t('ticketRefunded')
            : te(errorMessageKey(state.code));
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="refund-reason" className="text-caption text-zinc-600">
          {t('reason')}
        </label>
        <select id="refund-reason" name="reason" className={field} defaultValue="requested_by_customer">
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reasons.${r}`)}
            </option>
          ))}
        </select>
        <p className="text-caption text-zinc-500">{t('feePolicy')}</p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption text-zinc-600">{t('what')}</legend>
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
          <legend className="text-caption text-zinc-600">{t('tickets')}</legend>
          {tickets.map((tk) => (
            <label key={tk.id} className="flex min-h-6 items-center gap-2 text-body">
              <input type="checkbox" name="ticket" value={tk.id} className="size-5" />
              {tk.label}
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="refund-amount" className="text-caption text-zinc-600">
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor="refund-note" className="text-caption text-zinc-600">
          {t('note')}
        </label>
        <input id="refund-note" name="note" maxLength={500} className={field} />
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
