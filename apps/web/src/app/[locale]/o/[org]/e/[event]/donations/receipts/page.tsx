import {
  catchUpReceipts,
  type HostReceiptDto,
  quidProQuoNotice,
  receiptsConsoleQuery,
  taxNoticeText,
} from '@yayatoh/donations';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
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
  const { data, event: ev, can } = await loadEvent(org, event, 'donations');
  const t = await getTranslations('donations.receipts');
  if (!can('orders:read'))
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState title={t('noAccessTitle')} description={t('noAccessDescription')} />
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
  return (
    <>
      <p>
        <Link href={`/o/${org}/e/${event}/donations`} className="text-body underline underline-offset-2">
          {t('back')}
        </Link>
      </p>
      <PageHeader title={t('title')} description={t('subtitle')} />

      <Card className="flex flex-col gap-2">
        <h2 className="text-section">{t('charityTitle')}</h2>
        <StatusDot
          status={status === 'verified' ? 'success' : status === 'rejected' ? 'danger' : 'warning'}
          label={t(`charity.${status ?? 'none'}`)}
        />
        <p className="text-body text-zinc-600">{t(`charityBody.${status ?? 'none'}`)}</p>
        <Link href={`/o/${org}/charity`} className="self-start text-body underline underline-offset-2">
          {status ? t('charityLink') : t('charityStart')}
        </Link>
      </Card>

      <section aria-labelledby="fmv-heading" className="flex flex-col gap-3">
        <h2 id="fmv-heading" className="text-section">
          {t('fmvTitle')}
        </h2>
        <p className="text-body text-zinc-600">{t('fmvIntro')}</p>
        {view.ticketTypes.length === 0 ? (
          <EmptyState title={t('noTypesTitle')} description={t('noTypesDescription')} />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {view.ticketTypes.map((tt) => {
              const notice = quidProQuoNotice({
                priceMinor: tt.priceMinor,
                fmvMinor: tt.fmvMinor,
                currency: tt.currency,
              });
              return (
                <li key={tt.ticketTypeId}>
                  <Card className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-body font-medium">{tt.name}</h3>
                      <span className="text-caption text-zinc-600">
                        {tt.isDonation
                          ? t('priceFrom', { price: fmt(tt.priceMinor, tt.currency) })
                          : fmt(tt.priceMinor, tt.currency)}
                      </span>
                    </div>
                    <p className="text-body">
                      {tt.fmvMinor === null
                        ? t('noValue')
                        : t('valueLine', {
                            fmv: fmt(tt.fmvMinor, tt.currency),
                            goods: tt.description ?? t('goodsUnnamed'),
                          })}
                    </p>
                    {notice && !tt.isDonation ? (
                      <p className="text-caption text-zinc-600">
                        {t('noticePreview', {
                          notice: taxNoticeText({ ...notice, currency: tt.currency }, locale).text,
                        })}
                      </p>
                    ) : null}
                    {canWrite ? (
                      <details>
                        <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
                          {t('setValueFor', { name: tt.name })}
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
        {canWrite ? null : <p className="text-body text-zinc-500">{t('viewerNotice')}</p>}
      </section>

      <section aria-labelledby="receipts-heading" className="flex flex-col gap-3">
        <h2 id="receipts-heading" className="text-section">
          {t('receiptsTitle')}
        </h2>
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
              cell: (r) => `R-${String(r.number).padStart(5, '0')}`,
            },
            { key: 'date', header: t('columns.date'), cell: (r) => when.format(r.paidAt) },
            { key: 'donor', header: t('columns.donor'), cell: (r) => r.donorName },
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
              cell: (r) => (r.deductible ? fmt(r.deductibleMinor, r.currency) : t('notDeductible')),
            },
            {
              key: 'pdf',
              header: t('columns.pdf'),
              cell: (r) => (
                <a
                  href={`${prefix}/o/${org}/e/${event}/donations/receipts/${r.id}/pdf`}
                  className="inline-flex min-h-6 items-center underline underline-offset-2"
                >
                  {t('pdf', { number: `R-${String(r.number).padStart(5, '0')}` })}
                </a>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
