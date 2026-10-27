'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { HoldersState } from '@/app/[locale]/orders/[token]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { whatsappHref } from '@/lib/share.ts';

export interface HolderRow {
  readonly id: string;
  /** "Ticket 3 · General admission" */
  readonly label: string;
  readonly holderName: string;
}

export interface PendingHolder {
  readonly ticketId: string;
  readonly toName: string;
  readonly toEmail: string;
  readonly claimToken: string;
}

/**
 * "Name all holders at once" on the buyer's order page: a name and an email per ticket, one submit.
 * Each person is emailed their own ticket (a claim link); the buyer can also copy that link or
 * share it on WhatsApp, per person. Tickets already offered show who they went to.
 */
export function NameHoldersForm({
  action,
  tickets,
  pending,
}: {
  action: (prev: HoldersState, form: FormData) => Promise<HoldersState>;
  tickets: readonly HolderRow[];
  pending: readonly PendingHolder[];
}) {
  const t = useTranslations('nameHolders');
  const te = useTranslations();
  const locale = useLocale();
  const [state, formAction, pending_] = useActionState(action, INITIAL_FORM_STATE as HoldersState);
  const [copied, setCopied] = useState<string | null>(null);
  const offerOf = new Map(pending.map((p) => [p.ticketId, p]));
  const linkOf = (token: string) =>
    `${typeof window === 'undefined' ? '' : window.location.origin}${locale === 'en' ? '' : `/${locale}`}/claim/${token}`;
  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkOf(token));
      setCopied(token);
    } catch {
      setCopied(null);
    }
  };
  const error = !state.code
    ? null
    : state.reason === 'nothing_entered'
      ? t('nothingEntered')
      : state.reason === 'incomplete'
        ? t('incomplete')
        : state.reason === 'fee_not_accepted'
          ? t('feeRequired')
          : state.reason === 'same_holder'
            ? t('sameHolder')
            : state.reason === 'event_ended' ||
                state.reason === 'deadline_passed' ||
                state.reason === 'not_allowed' ||
                state.reason === 'ticket_void'
              ? t('notAllowed')
              : te(errorMessageKey(state.code));
  const badTicket = state.ticketId ? tickets.find((x) => x.id === state.ticketId) : undefined;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="m-0 text-body text-ink-2">{t('intro')}</p>
      <ul className="flex list-none flex-col gap-4 p-0">
        {tickets.map((tk, i) => {
          const offer = offerOf.get(tk.id);
          return (
            <li key={tk.id} className="flex flex-col gap-2 rounded-card border border-line p-3">
              <input type="hidden" name="ticket" value={tk.id} />
              <p className="m-0 text-body font-medium">{tk.label}</p>
              {offer ? (
                <div className="flex flex-col gap-1.5 rounded-card bg-surface-2 p-2.5">
                  <p className="m-0 text-caption">
                    {t('sentTo', { name: offer.toName, email: offer.toEmail })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => copy(offer.claimToken)}
                    >
                      {copied === offer.claimToken ? t('copied') : t('copyLink')}
                    </Button>
                    <a
                      href={whatsappHref(t('whatsappMessage', { url: linkOf(offer.claimToken) }))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-8 items-center text-caption font-bold text-primary-ink underline underline-offset-2"
                    >
                      {t('whatsapp')}
                      <span className="sr-only"> — {tk.label}</span>
                    </a>
                  </div>
                  <p className="m-0 text-caption text-ink-2">{t('changeHint')}</p>
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`holder-name-${i}`} className="text-[13px] font-bold text-ink">
                    {t('name')}
                  </label>
                  <input
                    id={`holder-name-${i}`}
                    name={`name:${tk.id}`}
                    autoComplete="off"
                    maxLength={120}
                    className="field"
                    defaultValue={offer?.toName ?? ''}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`holder-email-${i}`} className="text-[13px] font-bold text-ink">
                    {t('email')}
                  </label>
                  <input
                    id={`holder-email-${i}`}
                    name={`email:${tk.id}`}
                    type="email"
                    autoComplete="off"
                    maxLength={254}
                    className="field"
                    defaultValue={offer?.toEmail ?? ''}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-caption text-ink-2">{t('ownEmailHint')}</p>
      <div aria-live="polite" className="flex flex-col gap-2">
        {error ? <Alert title={badTicket ? `${badTicket.label}: ${error}` : error} /> : null}
        {state.ok ? <Alert tone="info" title={t('done')} /> : null}
      </div>
      <Button type="submit" size="lg" disabled={pending_} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
