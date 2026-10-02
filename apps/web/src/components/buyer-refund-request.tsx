'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';

/**
 * "Ask for a refund" on the buyer's order page (M3.10b): the buyer picks their tickets and may
 * leave a message; the organizer answers within the SLA under the refund policy shown above.
 */
export function BuyerRefundRequestForm({
  action,
  tickets,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  tickets: readonly { id: string; label: string }[];
}) {
  const t = useTranslations('refundOps.buyer');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  if (state.ok) return <Alert tone="info" title={t('sent')} />;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1.5" aria-describedby="refund-request-tickets-error">
        <legend className="text-caption text-ink-2">{t('tickets')}</legend>
        {tickets.map((tk) => (
          <label key={tk.id} className="flex min-h-6 items-center gap-2 text-body">
            <input type="checkbox" name="ticket" value={tk.id} defaultChecked className="size-5" />
            {tk.label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="refund-request-message" className="text-caption text-ink-2">
          {t('message')}
        </label>
        <textarea
          id="refund-request-message"
          name="message"
          maxLength={1000}
          rows={3}
          className="rounded-card border border-line bg-surface px-4 py-2 text-body"
        />
      </div>
      <div aria-live="polite" id="refund-request-tickets-error">
        {state.code ? (
          <Alert
            title={
              state.fields?.includes('ticketIds')
                ? t('pickTicket')
                : state.reason === 'policy_window_closed' || state.reason === 'policy_no_refunds'
                  ? t('noLonger')
                  : state.reason === 'request_open'
                    ? t('alreadyOpen')
                    : te(errorMessageKey(state.code))
            }
          />
        ) : null}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
