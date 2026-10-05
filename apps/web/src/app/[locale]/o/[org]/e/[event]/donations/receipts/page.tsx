import {
  catchUpReceipts,
  type HostReceiptDto,
  quidProQuoNotice,
  receiptsConsoleQuery,
  taxNoticeText,
} from '@yayatoh/donations';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import {
  Alert,
  buttonClass,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  SectionHeader,
  StatusPill,
  Table,
} from '@yayatoh/ui';
import { ChevronDown, ReceiptText, Ticket } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { type FieldSpec, ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { notifier } from '@/server/notifications.ts';
import { ports } from '@/server/ports.ts';
import { appOrigin } from '@/server/tenant-return.ts';
import { clearFairValueAction, setFairValueAction } from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.receipts');
  return { title: t('title') };
}

const decimal = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

/**
 * Tax receipts of an event (M4.8b, P4-11): the charity profile's status, a fair-market value per
 * ticket type (with the quid-pro-quo notice its page will show over $75), and the receipts issued,
 * one per payment, each as a PDF. Readers of orders see it; `events:write` sets values. Receipts
 * go to donors by email; the host sees who gave (P4-13).
 */
export default async function ReceiptsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can, opens } = await loadEvent(org, event, 'donations');
  const t = await getTranslations('donations.receipts');
  const tn = await getTranslations('nav');
  const crumbs = (
    <Crumbs
      items={[
        { label: data.org.name, href: `/o/${org}` },
        { label: ev.name, href: `/o/${org}/e/${event}` },
        { label: tn('donations'), href: `/o/${org}/e/${event}/donations` },
        { label: t('title') },
      ]}
    />
  );
  if (!can('orders:read'))
    return (
      <>
        <PageHeader breadcrumb={crumbs} title={t('title')} />
        <EmptyState
          title={t('noAccessTitle')}
          description={t('noAccessDescription')}
          action={
            <Link href={`/o/${org}/e/${event}/donations`} className={buttonClass('primary', 'md')}>
              {t('back')}
            </Link>
          }
        />
      </>
    );
  // Payments not yet receipted (the worker relays them in production; dev and e2e have none).
  await catchUpReceipts(data.org.id, { notifier, appOrigin: appOrigin() });
  const view = await executeQuery(receiptsConsoleQuery, { eventId: ev.id }, data.ctx, ports);
  const canWrite = can('events:write');
  const fmt = (minor: number, currency = ev.currency) => formatMoney(money(minor, currency), locale);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: data.org.timezone });
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const status = view.charityStatus;
  const errors = { fmvMinor: t('errors.amount'), description: t('errors.description') };
  const fields = (fmv: number | null, description: string | null): FieldSpec[] => [
    {
      kind: 'text',
      name: 'fmvMinor',
      label: t('fmv', { currency: ev.currency }),
      hint: t('fmvHint'),
      required: true,
      defaultValue: fmv === null ? undefined : decimal(fmv),
    },
    {
      kind: 'text',
      name: 'description',
      label: t('goods'),
      hint: t('goodsHint'),
      maxLength: 200,
      defaultValue: description ?? undefined,
    },
  ];
  const statusTone = { verified: 'success', rejected: 'danger', pending: 'waiting' } as const;
  const receiptNo = (n: number) => `R-${String(n).padStart(5, '0')}`;
  return (
    <>
      <PageHeader breadcrumb={crumbs} title={t('title')} description={t('subtitle')} />
      {canWrite ? null : <Alert tone="info" title={t('viewerNotice')} />}

      <Card size="panel" className="flex flex-col gap-3">
        <CardHeader
          title={t('charityTitle')}
          actions={
            <StatusPill
              tone={status ? statusTone[status] : 'neutral'}
              label={t(`charity.${status ?? 'none'}`)}
            />
          }
        />
        <p className="m-0 text-body text-ink-2">{t(`charityBody.${status ?? 'none'}`)}</p>
        <Link href={`/o/${org}/charity`} className={buttonClass('secondary', 'sm', 'self-start')}>
          {status ? t('charityLink') : t('charityStart')}
        </Link>
      </Card>

      <section aria-labelledby="fmv-heading" className="flex flex-col gap-4">
        <SectionHeader id="fmv-heading" title={t('fmvTitle')} description={t('fmvIntro')} />
        {view.ticketTypes.length === 0 ? (
          <EmptyState
            icon={<Ticket strokeWidth={2} />}
            title={t('noTypesTitle')}
            description={t('noTypesDescription')}
            action={
              canWrite && data.modules.has('ticketing') && opens('ticketsOrders') ? (
                <Link href={`/o/${org}/e/${event}/tickets-orders`} className={buttonClass('primary', 'md')}>
                  {t('addTicketTypes')}
                </Link>
              ) : (
                <Link href={`/o/${org}/e/${event}`} className={buttonClass('primary', 'md')}>
                  {t('backToEvent')}
                </Link>
              )
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {view.ticketTypes.map((tt) => {
              const notice = quidProQuoNotice({
                priceMinor: tt.priceMinor,
                fmvMinor: tt.fmvMinor,
                currency: tt.currency,
              });
              return (
                <li key={tt.ticketTypeId}>
                  <Card className="flex flex-col gap-3">
                    <CardHeader
                      as="h3"
                      title={tt.name}
                      meta={
                        <span className="tabular-nums">
                          {tt.isDonation
                            ? t('priceFrom', { price: fmt(tt.priceMinor, tt.currency) })
                            : fmt(tt.priceMinor, tt.currency)}
                        </span>
                      }
                    />
                    <p
                      className={
                        tt.fmvMinor === null
                          ? 'm-0 text-body text-ink-2'
                          : 'm-0 text-body font-bold text-ink tabular-nums'
                      }
                    >
                      {tt.fmvMinor === null
                        ? t('noValue')
                        : t('valueLine', {
                            fmv: fmt(tt.fmvMinor, tt.currency),
                            goods: tt.description ?? t('goodsUnnamed'),
                          })}
                    </p>
                    {notice && !tt.isDonation ? (
                      <p className="m-0 rounded-tile border border-line bg-surface-2 px-4 py-3 text-caption text-ink-2">
                        {t('noticePreview', {
                          notice: taxNoticeText({ ...notice, currency: tt.currency }, locale).text,
                        })}
                      </p>
                    ) : null}
                    {canWrite ? (
                      <details className="group border-t border-line pt-2">
                        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-control text-[13px] font-bold text-primary-ink underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                          {t('setValueFor', { name: tt.name })}
                          <ChevronDown
                            aria-hidden="true"
                            className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180"
                            strokeWidth={2}
                          />
                        </summary>
                        <div className="flex flex-col gap-3 pt-3">
                          <ProgramForm
                            action={setFairValueAction.bind(null, org, event, tt.ticketTypeId)}
                            fields={fields(tt.fmvMinor, tt.description)}
                            idPrefix={`fmv-${tt.ticketTypeId}`}
                            submitLabel={t('save')}
                            successLabel={t('saved')}
                            errors={errors}
                          />
                          {tt.fmvMinor !== null ? (
                            <ProgramForm
                              action={clearFairValueAction.bind(null, org, event, tt.ticketTypeId)}
                              fields={[]}
                              idPrefix={`fmv-clear-${tt.ticketTypeId}`}
                              submitLabel={t('clear', { name: tt.name })}
                              successLabel={t('cleared')}
                              errors={errors}
                            />
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="receipts-heading" className="flex flex-col gap-4">
        <SectionHeader id="receipts-heading" title={t('receiptsTitle')} />
        {view.receipts.length === 0 ? (
          <EmptyState
            icon={<ReceiptText strokeWidth={2} />}
            title={t('noReceipts')}
            action={
              <Link href={`/o/${org}/e/${event}/donations`} className={buttonClass('primary', 'md')}>
                {t('back')}
              </Link>
            }
          />
        ) : (
          <Table<HostReceiptDto>
            caption={t('receiptsCaption')}
            rows={view.receipts}
            rowKey={(r) => r.id}
            empty={t('noReceipts')}
            columns={[
              {
                key: 'number',
                header: t('columns.number'),
                mono: true,
                cell: (r) => receiptNo(r.number),
              },
              { key: 'date', header: t('columns.date'), cell: (r) => when.format(r.paidAt) },
              {
                key: 'donor',
                header: t('columns.donor'),
                cell: (r) => <span className="font-bold text-ink">{r.donorName}</span>,
              },
              { key: 'kind', header: t('columns.kind'), cell: (r) => t(`kind.${r.kind}`) },
              {
                key: 'amount',
                header: t('columns.amount'),
                align: 'end',
                mono: true,
                cell: (r) => fmt(r.amountMinor, r.currency),
              },
              {
                key: 'deductible',
                header: t('columns.deductible'),
                align: 'end',
                mono: true,
                cell: (r) =>
                  r.deductible ? (
                    fmt(r.deductibleMinor, r.currency)
                  ) : (
                    <StatusPill tone="neutral" label={t('notDeductible')} />
                  ),
              },
              {
                key: 'pdf',
                header: t('columns.pdf'),
                cell: (r) => (
                  <a
                    href={`${prefix}/o/${org}/e/${event}/donations/receipts/${r.id}/pdf`}
                    className={buttonClass('ghost', 'sm', 'text-primary-ink')}
                  >
                    {t('pdf', { number: receiptNo(r.number) })}
                  </a>
                ),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}
