import { randomUUID } from 'node:crypto';
import { formatMoney, money } from '@yayatoh/kernel';
import type { OrderInvoiceDto } from '@yayatoh/orders';
import { Card, CardHeader, StatusPill } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { z } from 'zod';
import { RecordInvoicePaymentForm, VoidInvoiceForm } from '@/components/invoice-forms.tsx';
import type { FormState } from '@/lib/form-state.ts';
import { minorToDecimal } from '@/lib/minor-decimal.ts';

type Invoice = z.infer<typeof OrderInvoiceDto>;
type Action = (prev: FormState, form: FormData) => Promise<FormState>;

/** An invoice's status as a StatusPill tone (dot + word). */
export const INVOICE_TONE = { open: 'waiting', paid: 'success', void: 'neutral' } as const;

/** A calendar day as the locale writes it. */
export const dayLabel = (locale: string, day: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

/**
 * M5.1d: an order's invoice in the console: number, PO, terms, what is paid and what is due, its
 * payments (pay link or recorded), the PDF, and for finance roles the forms to record a payment
 * and to void it while nothing was paid. Viewers see the facts only.
 */
export async function InvoicePanel({
  invoice,
  locale,
  today,
  pdfHref,
  canManage,
  recordAction,
  voidAction,
}: {
  invoice: Invoice;
  locale: string;
  /** The event-local calendar day (the latest a payment may be dated). */
  today: string;
  pdfHref: string;
  canManage: boolean;
  recordAction: Action;
  voidAction: Action;
}) {
  const t = await getTranslations('invoices');
  const fmt = (minor: number) => formatMoney(money(minor, invoice.currency), locale);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const balanceDecimal = minorToDecimal(invoice.balanceMinor, invoice.currency);
  const facts: [string, string][] = [
    [t('panel.number'), invoice.label],
    [t('panel.issued'), dayLabel(locale, invoice.issuedOn)],
    [t('panel.due'), dayLabel(locale, invoice.dueOn)],
    [t('panel.terms'), t('panel.termsValue')],
    [t('panel.po'), invoice.poNumber ?? t('panel.none')],
    [t('panel.company'), invoice.billingCompany ?? t('panel.none')],
    [t('panel.total'), fmt(invoice.totalMinor)],
    [t('panel.paid'), fmt(invoice.paidMinor)],
    [t('panel.balance'), fmt(invoice.balanceMinor)],
  ];
  return (
    <section aria-labelledby="invoice-heading" className="flex flex-col gap-3">
      <Card className="flex flex-col gap-5">
        <CardHeader
          id="invoice-heading"
          title={t('panel.title', { label: invoice.label })}
          actions={
            <>
              <StatusPill tone={INVOICE_TONE[invoice.status]} label={t(`status.${invoice.status}`)} />
              {invoice.overdue ? <StatusPill tone="danger" label={t('overdue')} /> : null}
            </>
          }
        />
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <dt className="text-[13px] font-bold text-ink-2">{k}</dt>
              <dd className="m-0 text-body text-ink tabular-nums" dir="auto">
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {invoice.status === 'void' ? (
          <p className="m-0 rounded-tile bg-surface-2 px-4 py-3 text-body text-ink-2">
            {t('panel.voided', { reason: invoice.voidReason ?? '' })}
            {invoice.paidAfterVoidMinor > 0
              ? ` ${t('panel.paidAfterVoid', { amount: fmt(invoice.paidAfterVoidMinor) })}`
              : ''}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-body font-bold text-ink">{t('panel.payments')}</h3>
          {invoice.payments.length === 0 ? (
            <p className="m-0 text-body text-ink-2">{t('panel.noPayments')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-tile border border-line p-0">
              {invoice.payments.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
                >
                  <span className="text-body text-ink">
                    {t(`methods.${p.method}`)}
                    {p.reference ? ` · ${p.reference}` : ''}
                    {p.status === 'failed' ? ` · ${t('panel.failed')}` : ''}
                  </span>
                  <span className="text-caption text-ink-2 tabular-nums">
                    {p.receivedOn
                      ? dayLabel(locale, p.receivedOn)
                      : when.format(p.completedAt ?? p.createdAt)}
                  </span>
                  <span className="font-bold text-ink tabular-nums">{fmt(p.amountMinor)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <a
          href={pdfHref}
          className="inline-flex min-h-8 items-center self-start rounded-[10px] text-body font-bold text-primary-ink underline-offset-2 hover:underline"
        >
          {t('panel.pdf')}
        </a>
      </Card>
      {canManage && invoice.status === 'open' ? (
        <>
          <Card className="flex flex-col gap-3">
            <CardHeader as="h3" title={t('record.title')} />
            <RecordInvoicePaymentForm
              action={recordAction}
              currency={invoice.currency}
              balance={balanceDecimal}
              balanceLabel={fmt(invoice.balanceMinor)}
              today={today}
              requestKey={randomUUID()}
            />
          </Card>
          {invoice.paidMinor === 0 ? (
            <details className="rounded-card border border-line bg-surface p-4 glass">
              <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-[10px] px-2 text-body font-bold text-danger hover:bg-surface-3">
                {t('void.title')}
              </summary>
              <div className="pt-3">
                <VoidInvoiceForm action={voidAction} />
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
