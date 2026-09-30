import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { REFUND_REQUEST_STATUSES, refundRequestCountsQuery, refundRequestsQuery } from '@yayatoh/orders';
import { roleCan } from '@yayatoh/tenancy';
import { EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

type Status = (typeof REFUND_REQUEST_STATUSES)[number];

/**
 * The refund-request queue (M3.10b): buyers' requests across the org's events, open ones oldest
 * first with their age and the SLA (answer within 5 business days), answered ones newest first.
 * Each opens the order, where it is approved or declined. Anyone who can read orders sees it.
 */
export default async function RefundRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('ticketing') || !roleCan(data.role, 'orders:read')) notFound();
  const sp = await searchParams;
  const status: Status = (REFUND_REQUEST_STATUSES as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as Status)
    : 'open';
  const t = await getTranslations('refundOps');
  const [rows, counts] = await Promise.all([
    executeQuery(refundRequestsQuery, { status }, data.ctx, ports),
    executeQuery(refundRequestCountsQuery, {}, data.ctx, ports),
  ]);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const now = data.ctx.now.getTime();
  const age = (from: Date) => {
    const hours = Math.max(0, Math.floor((now - from.getTime()) / 3_600_000));
    return t('queue.age', { days: Math.floor(hours / 24), hours });
  };
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  return (
    <>
      <PageHeader title={t('queue.title')} description={t('queue.description')} />
      <p className="text-body" aria-live="polite">
        {t('queue.summary', { open: counts.open, overdue: counts.overdue })}
      </p>
      <nav aria-label={t('queue.tabsLabel')} className="flex flex-wrap gap-2">
        {REFUND_REQUEST_STATUSES.map((s) => (
          <Link
            key={s}
            href={s === 'open' ? `/o/${org}/refund-requests` : `/o/${org}/refund-requests?status=${s}`}
            aria-current={s === status ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center rounded-pill border px-4 text-body ${
              s === status ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white'
            }`}
          >
            {t(`request.status.${s}`)}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title={t(`queue.empty.${status}`)} />
      ) : (
        <Table
          caption={t('queue.caption', { status: t(`request.status.${status}`) })}
          rowKey={(r) => r.id}
          rows={rows}
          columns={[
            {
              key: 'buyer',
              header: t('queue.buyer'),
              cell: (r) => (
                <span className="flex flex-col">
                  <Link
                    href={`/o/${org}/e/${r.eventSlug}/orders/${r.orderId}`}
                    className="inline-flex min-h-6 items-center underline underline-offset-2"
                  >
                    {r.buyerName}
                  </Link>
                  <span className="text-caption text-zinc-500">{r.buyerEmail}</span>
                </span>
              ),
            },
            { key: 'event', header: t('queue.event'), cell: (r) => r.eventName },
            {
              key: 'tickets',
              header: t('queue.tickets'),
              cell: (r) => t('request.tickets', { count: r.tickets }),
            },
            { key: 'asked', header: t('queue.asked'), cell: (r) => when.format(r.createdAt) },
            ...(status === 'open'
              ? [
                  {
                    key: 'age',
                    header: t('queue.waiting'),
                    cell: (r: (typeof rows)[number]) => age(r.createdAt),
                  },
                  {
                    key: 'due',
                    header: t('queue.due'),
                    cell: (r: (typeof rows)[number]) => (
                      <span className="flex flex-col">
                        <span>{when.format(r.dueAt)}</span>
                        <StatusDot
                          status={r.overdue ? 'danger' : 'success'}
                          label={r.overdue ? t('request.overdue') : t('request.onTime')}
                        />
                      </span>
                    ),
                  },
                ]
              : [
                  {
                    key: 'decided',
                    header: t('queue.decided'),
                    cell: (r: (typeof rows)[number]) => (r.decidedAt ? when.format(r.decidedAt) : ''),
                  },
                  {
                    key: 'outcome',
                    header: t('queue.outcome'),
                    cell: (r: (typeof rows)[number]) =>
                      r.refund
                        ? `${fmt(r.refund.amountMinor, r.currency)} · ${t(`queue.refundStatus.${r.refund.status}`)}`
                        : (r.declineReason ?? ''),
                  },
                ]),
          ]}
        />
      )}
    </>
  );
}
