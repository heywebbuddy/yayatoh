import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { BOOKING_FILTERS, type BookingFilter, bookingSearchQuery } from '@yayatoh/orders';
import type { BulkOperationDto } from '@yayatoh/platform';
import { bookingsExportBulk } from '@yayatoh/reports';
import { Button, buttonClass, EmptyState, Input, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { fmtMoney, ReportTabs } from '@/components/reports.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { exportBookingsAction } from './actions.ts';

const LIMIT = 100;
const PILL = 'rounded-pill bg-zinc-100 px-2 py-px font-mono text-[11px] text-zinc-700';

/**
 * Booking search (M1.12): one event's orders by buyer, email, order reference, promo code or
 * ticket code, filtered by kind (paid, complimentary, failed, refunded, …). A plain GET form,
 * so it works without JavaScript and every search has a shareable URL.
 */
export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ q?: string; filter?: string; op?: string; exportError?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { data, event: ev, can } = await loadEvent(org, event, 'analysis');
  const t = await getTranslations();
  const base = `/o/${org}/e/${event}/analysis`;
  if (!can('orders:read') || !data.modules.has('ticketing')) {
    return (
      <>
        <PageHeader title={t('reports.tabs.bookings')} description={ev.name} />
        <EmptyState title={t('reports.noAccessTitle')} description={t('reports.noAccessDescription')} />
      </>
    );
  }
  const q = (sp.q ?? '').trim().slice(0, 200);
  const filter: BookingFilter = (BOOKING_FILTERS as readonly string[]).includes(sp.filter ?? '')
    ? (sp.filter as BookingFilter)
    : 'all';
  const r = await executeQuery(
    bookingSearchQuery,
    { eventId: ev.id, q, filter, limit: LIMIT },
    data.ctx,
    ports,
  );
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const n = (v: number) => formatNumber(v, locale);
  const canExport = can('attendees:export') && data.modules.has('reports');
  // The export the page was sent back to (progress, then the download).
  let op: BulkOperationDto | null = null;
  if (canExport && sp.op && /^[0-9a-f-]{36}$/.test(sp.op)) {
    op = await executeQuery(bookingsExportBulk.status, { operationId: sp.op }, data.ctx, ports).catch(
      (err) => {
        if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) return null;
        throw err;
      },
    );
    if (op && op.eventId !== ev.id) op = null;
  }
  const opActive = op ? ['queued', 'running'].includes(op.status) : false;

  return (
    <>
      <PageHeader title={t('reports.tabs.bookings')} description={ev.name} />
      <ReportTabs base={base} current="bookings" finance={can('finance:read')} />
      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            name="q"
            type="search"
            defaultValue={q}
            maxLength={200}
            label={t('reports.bookings.search')}
            hint={t('reports.bookings.searchHint')}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:mb-[22px]">
          <label htmlFor="booking-filter" className="text-caption text-zinc-600">
            {t('reports.bookings.show')}
          </label>
          <select
            id="booking-filter"
            name="filter"
            defaultValue={filter}
            className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
          >
            {BOOKING_FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`reports.bookings.filters.${f}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" className="sm:mb-[22px]">
          {t('reports.bookings.submit')}
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-body text-zinc-600">
          {t('reports.bookings.count', { total: r.total })}
          {r.total > r.items.length
            ? ` · ${t('reports.bookings.showing', { shown: n(r.items.length), total: n(r.total) })}`
            : ''}
        </p>
        {canExport && r.total > 0 ? (
          <StepUpForm action={exportBookingsAction.bind(null, org, event)}>
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="filter" value={filter} />
            <Button type="submit" variant="secondary" size="sm">
              {t('reports.bookings.export')}
            </Button>
          </StepUpForm>
        ) : null}
      </div>
      {sp.exportError ? (
        <p
          role="alert"
          className="rounded-card border border-pink-700 bg-pink-50 px-4 py-3 text-body text-pink-700"
        >
          {t('reports.bookings.exportError', { reason: t(errorMessageKey(sp.exportError)) })}
        </p>
      ) : null}
      {op ? (
        <section
          aria-labelledby="export-heading"
          className="flex flex-col gap-2 rounded-panel border border-zinc-200 bg-white px-5 py-4"
        >
          {opActive ? <AutoRefresh seconds={2} /> : null}
          <h2 id="export-heading" className="text-section">
            {t('reports.bookings.exportTitle')}
          </h2>
          <p className="text-body" role="status">
            {op.status === 'done'
              ? t('bulk.exportDone', { succeeded: n(op.succeeded) })
              : t(`bulk.status.${op.status}`, {
                  processed: n(op.processed),
                  total: n(op.total),
                  succeeded: n(op.succeeded),
                  failed: n(op.failed),
                  undone: n(op.undone),
                })}
          </p>
          {op.status === 'done' && op.hasFile ? (
            <a
              href={`${locale === 'en' ? '' : `/${locale}`}${base}/bookings/exports/${op.id}`}
              className={buttonClass('primary', 'sm', 'self-start')}
              download
            >
              {t('bulk.download')}
            </a>
          ) : null}
        </section>
      ) : null}
      {r.items.length === 0 ? (
        <EmptyState
          title={t('reports.bookings.emptyTitle')}
          description={t('reports.bookings.emptyDescription')}
        />
      ) : (
        <Table
          caption={t('reports.bookings.caption')}
          rowKey={(o) => o.id}
          rows={r.items}
          columns={[
            {
              key: 'buyer',
              header: t('reports.bookings.buyer'),
              cell: (o) => (
                <span className="flex flex-col">
                  <Link href={`/o/${org}/e/${event}/orders/${o.id}`} className="underline underline-offset-2">
                    {o.buyerName}
                  </Link>
                  <span className="text-caption text-zinc-500">{o.buyerEmail}</span>
                </span>
              ),
            },
            {
              key: 'tickets',
              header: t('reports.bookings.tickets'),
              cell: (o) => n(o.tickets),
              mono: true,
              align: 'end',
            },
            {
              key: 'total',
              header: t('reports.bookings.total'),
              cell: (o) => (o.comp ? t('reports.bookings.comp') : fmtMoney(o.totalMinor, o.currency, locale)),
              mono: true,
              align: 'end',
            },
            {
              key: 'status',
              header: t('reports.bookings.status'),
              cell: (o) => (
                <span className="flex flex-wrap items-center gap-2">
                  <StatusDot
                    status={
                      o.status === 'paid'
                        ? 'success'
                        : o.status === 'payment_failed'
                          ? 'danger'
                          : ['expired', 'cancelled'].includes(o.status)
                            ? 'neutral'
                            : 'warning'
                    }
                    label={t(`order.status.${o.status}`)}
                  />
                  {o.collectedBy === 'organizer' ? (
                    <span className={PILL}>{t('reports.bookings.boxOffice')}</span>
                  ) : null}
                  {o.promoCode ? <span className={PILL}>{o.promoCode}</span> : null}
                </span>
              ),
            },
            {
              key: 'date',
              header: t('reports.bookings.date'),
              cell: (o) => date.format(o.createdAt),
            },
          ]}
        />
      )}
    </>
  );
}
