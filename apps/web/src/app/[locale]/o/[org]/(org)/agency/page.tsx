import { agencyClientsQuery } from '@yayatoh/agency';
import { executeQuery } from '@yayatoh/kernel';
import { buttonClass, EmptyState, StatusPill, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatDate, formatNumber } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { loadAgency } from './load.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agency');
  return { title: t('tab.clients') };
}

const pct = (bps: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(bps / 10_000);

/** Clients (M6.7a): every live client, its access, its next event and headline numbers. */
export default async function AgencyClientsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const { data, canRead } = await loadAgency(org);
  if (!canRead) return null;
  const t = await getTranslations('agency');
  const to = await getTranslations('agencyOps');
  const ta = await getTranslations('agencies');
  const clients = await executeQuery(agencyClientsQuery, {}, data.ctx, ports);
  if (clients.length === 0)
    return (
      <EmptyState
        title={t('emptyTitle')}
        description={t('emptyDescription', { address: data.org.slug })}
        action={
          <Link href={`/o/${org}/team`} className={buttonClass('primary', 'md')}>
            {to('actions.inviteTeam')}
          </Link>
        }
      />
    );
  const n = (v: number) => formatNumber(v, locale);
  return (
    <Table
      caption={t('tab.clients')}
      rowKey={(c) => c.clientOrgId}
      rows={clients}
      empty=""
      columns={[
        {
          key: 'client',
          header: t('client'),
          cell: (c) => (
            <span className="flex flex-col gap-1">
              <span className="font-semibold">{c.name}</span>
              <span className="flex flex-wrap gap-1.5">
                <StatusPill tone="info" label={ta('roleLabel', { role: c.role })} />
                {c.finance ? <StatusPill tone="waiting" label={t('finance')} /> : null}
              </span>
            </span>
          ),
        },
        {
          key: 'next',
          header: t('nextEvent'),
          cell: (c) =>
            c.snapshot?.nextEventName && c.snapshot.nextEventAt ? (
              <span className="flex flex-col">
                <span>{c.snapshot.nextEventName}</span>
                <span className="text-caption text-ink-2">
                  {formatDate(
                    c.snapshot.nextEventAt.toISOString(),
                    { locale, currency: 'USD', timeZone: c.timezone },
                    { year: 'numeric', month: 'short', day: 'numeric' },
                  )}
                </span>
              </span>
            ) : c.snapshot ? (
              <span className="text-ink-2">{t('noNextEvent')}</span>
            ) : (
              <span className="text-ink-2">{t('notRefreshed')}</span>
            ),
        },
        {
          key: 'upcoming',
          header: t('upcoming'),
          align: 'end',
          cell: (c) => (c.snapshot ? n(c.snapshot.eventsUpcoming) : '—'),
        },
        {
          key: 'tickets',
          header: t('tickets'),
          align: 'end',
          cell: (c) => (c.snapshot ? n(c.snapshot.ticketsValid) : '—'),
        },
        {
          key: 'rate',
          header: t('checkinRate'),
          align: 'end',
          cell: (c) => (c.snapshot ? pct(c.snapshot.checkinBps, locale) : '—'),
        },
        {
          key: 'asOf',
          header: t('refreshedAt'),
          cell: (c) =>
            c.snapshot
              ? formatDate(
                  c.snapshot.refreshedAt.toISOString(),
                  { locale, currency: 'USD', timeZone: data.org.timezone },
                  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
                )
              : '—',
        },
        {
          key: 'open',
          header: t('open'),
          align: 'end',
          cell: (c) => (
            <Link
              href={`/o/${c.slug}`}
              className={buttonClass('secondary', 'sm')}
              aria-label={t('openNamed', { client: c.name })}
            >
              {t('open')}
            </Link>
          ),
        },
      ]}
    />
  );
}
