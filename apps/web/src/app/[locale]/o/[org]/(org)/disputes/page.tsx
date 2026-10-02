import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { DISPUTE_QUEUE_TABS, disputeQueueQuery } from '@yayatoh/reports';
import { roleCan } from '@yayatoh/tenancy';
import { EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

type Tab = (typeof DISPUTE_QUEUE_TABS)[number];

/**
 * The dispute queue (M3.10c): every chargeback of the org with its evidence deadline (time left,
 * in the event's timezone), status and amount; open ones soonest deadline first. Each opens the
 * evidence review (owners, admins, finance respond; finance data, so `finance:read` to see it).
 */
export default async function DisputesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('ticketing') || !roleCan(data.role, 'finance:read')) notFound();
  const sp = await searchParams;
  const tab: Tab = (DISPUTE_QUEUE_TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as Tab)
    : 'open';
  const t = await getTranslations('supportTools.disputes');
  const td = await getTranslations('disputes');
  const queue = await executeQuery(disputeQueueQuery, { tab }, data.ctx, ports);
  const canRespond = roleCan(data.role, 'disputes:respond');
  const left = (hours: number | null) =>
    hours === null
      ? t('noDeadline')
      : hours < 0
        ? t('overdue')
        : hours < 48
          ? t('hoursLeft', { hours })
          : t('daysLeft', { days: Math.floor(hours / 24) });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <p className="text-body" aria-live="polite">
        {t('summary', { open: queue.counts.open, soon: queue.counts.dueSoon })}
      </p>
      <nav aria-label={t('tabsLabel')} className="flex flex-wrap gap-2">
        {DISPUTE_QUEUE_TABS.map((s) => (
          <Link
            key={s}
            href={s === 'open' ? `/o/${org}/disputes` : `/o/${org}/disputes?tab=${s}`}
            aria-current={s === tab ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center rounded-pill border px-4 text-body ${
              s === tab ? 'border-ink bg-tag text-white' : 'border-line bg-surface'
            }`}
          >
            {t(`tabs.${s}`, { count: s === 'open' ? queue.counts.open : queue.counts.closed })}
          </Link>
        ))}
      </nav>
      {queue.items.length === 0 ? (
        <EmptyState title={t(`empty.${tab}`)} />
      ) : (
        <Table
          caption={t(`caption.${tab}`)}
          rowKey={(d) => d.id}
          rows={queue.items}
          columns={[
            {
              key: 'buyer',
              header: t('buyer'),
              cell: (d) => (
                <span className="flex flex-col">
                  <Link
                    href={`/o/${org}/e/${d.eventSlug}/orders/${d.orderId}`}
                    className="inline-flex min-h-6 items-center underline underline-offset-2"
                  >
                    {d.buyerName}
                  </Link>
                  <span className="text-caption text-ink-2">{d.eventName}</span>
                </span>
              ),
            },
            {
              key: 'amount',
              header: t('amount'),
              cell: (d) => formatMoney(money(d.amountMinor, d.currency), locale),
              mono: true,
              align: 'end',
            },
            { key: 'reason', header: t('reason'), cell: (d) => d.reason },
            {
              key: 'status',
              header: t('status'),
              cell: (d) => (
                <StatusDot
                  status={d.status === 'won' ? 'success' : d.status === 'lost' ? 'danger' : 'warning'}
                  label={td(`status.${d.status}`)}
                />
              ),
            },
            {
              key: 'deadline',
              header: t('deadline'),
              cell: (d) => (
                <span className="flex flex-col">
                  <span>
                    {d.evidenceDueBy
                      ? new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: d.eventTimezone,
                        }).format(d.evidenceDueBy)
                      : '—'}
                  </span>
                  {d.status === 'open' ? (
                    <StatusDot
                      status={d.urgency === 2 ? 'danger' : d.urgency === 1 ? 'warning' : 'success'}
                      label={left(d.hoursLeft)}
                    />
                  ) : null}
                </span>
              ),
            },
            {
              key: 'act',
              header: t('action'),
              cell: (d) =>
                d.status === 'open' && canRespond ? (
                  <Link
                    href={`/o/${org}/e/${d.eventSlug}/orders/${d.orderId}/disputes/${d.id}`}
                    className="inline-flex min-h-6 items-center underline underline-offset-2"
                  >
                    {t('respond')}
                  </Link>
                ) : d.status === 'evidence_submitted' ? (
                  <span className="text-caption text-ink-2">{t('submitted')}</span>
                ) : null,
            },
          ]}
        />
      )}
    </>
  );
}
