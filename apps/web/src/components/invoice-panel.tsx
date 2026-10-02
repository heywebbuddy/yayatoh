import { randomUUID } from 'node:crypto';
import { formatMoney, money } from '@yayatoh/kernel';
import type { OrderInvoiceDto } from '@yayatoh/orders';
import { Card, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import type { z } from 'zod';
import { RecordInvoicePaymentForm, VoidInvoiceForm } from '@/components/invoice-forms.tsx';
import type { FormState } from '@/lib/form-state.ts';
import { minorToDecimal } from '@/lib/minor-decimal.ts';

type Invoice = z.infer<typeof OrderInvoiceDto>;
type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export const INVOICE_DOT = { open: 'warning', paid: 'success', void: 'neutral' } as const;

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
      <h2 id="invoice-heading" className="text-section">
        {t('panel.title', { label: invoice.label })}
      </h2>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusDot status={INVOICE_DOT[invoice.status]} label={t(`status.${invoice.status}`)} />
          {invoice.overdue ? <StatusDot status="danger" label={t('overdue')} /> : null}
          <a href={pdfHref} className="text-body underline underline-offset-2">
            {t('panel.pdf')}
          </a>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-caption text-zinc-600">{k}</dt>
              <dd className="m-0 text-body" dir="auto">
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {invoice.status === 'void' ? (
          <p className="text-body text-zinc-600">
            {t('panel.voided', { reason: invoice.voidReason ?? '' })}
            {invoice.paidAfterVoidMinor > 0
              ? ` ${t('panel.paidAfterVoid', { amount: fmt(invoice.paidAfterVoidMinor) })}`
              : ''}
          </p>
        ) : null}
        <h3 className="text-body font-medium">{t('panel.payments')}</h3>
        {invoice.payments.length === 0 ? (
          <p className="text-body text-zinc-600">{t('panel.noPayments')}</p>
        ) : (
          <ul className="flex list-none flex-col divide-y divide-zinc-100 p-0">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
                <span>
                  {t(`methods.${p.method}`)}
                  {p.reference ? ` · ${p.reference}` : ''}
                  {p.status === 'failed' ? ` · ${t('panel.failed')}` : ''}
                </span>
                <span className="text-caption text-zinc-600">
                  {p.receivedOn ? dayLabel(locale, p.receivedOn) : when.format(p.completedAt ?? p.createdAt)}
                </span>
                <span className="font-mono tabular-nums">{fmt(p.amountMinor)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canManage && invoice.status === 'open' ? (
        <>
          <Card className="flex flex-col gap-3">
            <h3 className="text-body font-medium">{t('record.title')}</h3>
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
            <details className="rounded-card border border-zinc-200 p-4">
              <summary className="min-h-6 cursor-pointer text-body">{t('void.title')}</summary>
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
