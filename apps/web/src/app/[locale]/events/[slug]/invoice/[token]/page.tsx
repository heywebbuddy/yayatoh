import { randomUUID } from 'node:crypto';
import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { type PublicInvoiceDto, publicInvoice } from '@yayatoh/orders';
import { Alert, Card, Label, PageHeader, StatusDot } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { INVOICE_DOT } from '@/components/invoice-panel.tsx';
import { InvoicePayForm } from '@/components/invoice-pay-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { minorToDecimal } from '@/lib/minor-decimal.ts';
import { pageLocale } from '@/server/locale.ts';
import { payInvoiceAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invoices.public');
  return { title: t('metaTitle'), robots: { index: false } };
}

type Params = {
  params: Promise<{ locale: string; slug: string; token: string }>;
  searchParams: Promise<{ paid?: string }>;
};

const day = (locale: string, d: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/**
 * The buyer's invoice (M5.1d, by its signed link): what was bought, what is paid and what is due
 * by when, the PDF, and the pay step for all or part of the balance. Phone-first; one primary
 * action. Allowlisted (`PublicInvoiceDto`): no fees, internal notes or void reasons.
 */
export default async function InvoicePage({ params, searchParams }: Params) {
  const { locale, slug, token } = await params;
  pageLocale(locale);
  const target = await checkoutTarget(slug);
  const ev = target ? await publicEventBySlug(slug) : null;
  if (!target || !ev) notFound();
  let inv: PublicInvoiceDto;
  try {
    inv = await publicInvoice(target.orgId, target.eventId, token);
  } catch (err) {
    if (isDomainError(err)) notFound();
    throw err;
  }
  const t = await getTranslations('invoices');
  const sp = await searchParams;
  const fmt = (minor: number) => formatMoney(money(minor, inv.currency), locale);
  const open = inv.status === 'open' && inv.balanceMinor > 0;
  const facts: [string, string][] = [
    [t('panel.issued'), day(locale, inv.issuedOn)],
    [t('panel.due'), day(locale, inv.dueOn)],
    ...(inv.poNumber ? [[t('panel.po'), inv.poNumber] as [string, string]] : []),
    ...(inv.billingCompany ? [[t('panel.company'), inv.billingCompany] as [string, string]] : []),
    [t('panel.total'), fmt(inv.totalMinor)],
    [t('panel.paid'), fmt(inv.paidMinor)],
    [t('panel.balance'), fmt(inv.balanceMinor)],
  ];
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-16"
    >
      <PageHeader
        eyebrow={<Label>{ev.name}</Label>}
        title={t('public.title', { label: inv.label })}
        description={t(`public.lead.${inv.status}`, { name: inv.buyerName, due: day(locale, inv.dueOn) })}
      />
      {sp.paid === '1' ? (
        <div aria-live="polite">
          <Alert tone="info" title={t('public.thanks')}>
            {inv.status === 'paid'
              ? t('public.thanksPaid')
              : t('public.thanksPart', { balance: fmt(inv.balanceMinor) })}
          </Alert>
        </div>
      ) : null}
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusDot status={INVOICE_DOT[inv.status]} label={t(`status.${inv.status}`)} />
          {inv.overdue ? <StatusDot status="danger" label={t('overdue')} /> : null}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-caption text-ink-2">{k}</dt>
              <dd className="m-0 text-body" dir="auto">
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <section aria-labelledby="invoice-lines" className="flex flex-col gap-2">
          <h2 id="invoice-lines" className="text-body font-medium">
            {t('public.items')}
          </h2>
          <ul className="flex list-none flex-col divide-y divide-line p-0">
            {inv.lines.map((l) => (
              <li key={l.name} className="flex justify-between gap-4 py-2">
                <span>
                  {l.quantity} × {l.name}
                </span>
                <span className="font-mono tabular-nums">{fmt(l.totalMinor)}</span>
              </li>
            ))}
          </ul>
        </section>
        {inv.payments.length ? (
          <section aria-labelledby="invoice-payments" className="flex flex-col gap-2">
            <h2 id="invoice-payments" className="text-body font-medium">
              {t('panel.payments')}
            </h2>
            <ul className="flex list-none flex-col divide-y divide-line p-0">
              {inv.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-4 py-2">
                  <span>
                    {t(`methods.${p.method}`)}
                    {p.receivedOn ? ` · ${day(locale, p.receivedOn)}` : ''}
                  </span>
                  <span className="font-mono tabular-nums">{fmt(p.amountMinor)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <a
          href={`/events/${slug}/invoice/${token}/pdf?locale=${locale}`}
          className="inline-flex min-h-11 items-center self-start text-body underline underline-offset-2"
        >
          {t('public.pdf')}
        </a>
      </Card>
      {open ? (
        <section aria-labelledby="invoice-pay">
          <Card className="flex flex-col gap-3">
            <h2 id="invoice-pay" className="text-section">
              {t('public.payTitle')}
            </h2>
            <p className="text-body text-ink-2">{t('public.payHint', { balance: fmt(inv.balanceMinor) })}</p>
            <InvoicePayForm
              action={payInvoiceAction.bind(null, slug, token, inv.currency)}
              currency={inv.currency}
              balance={minorToDecimal(inv.balanceMinor, inv.currency)}
              requestKey={randomUUID()}
            />
          </Card>
        </section>
      ) : null}
      <Link
        href={`/events/${slug}`}
        className="inline-flex min-h-11 items-center self-start text-body underline underline-offset-2"
      >
        {t('public.backToEvent')}
      </Link>
    </main>
  );
}
