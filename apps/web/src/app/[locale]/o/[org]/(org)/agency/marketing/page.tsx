import { agencyClientsQuery } from '@yayatoh/agency';
import { executeQuery } from '@yayatoh/kernel';
import { buttonClass, EmptyState, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { loadAgency } from '../load.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agency');
  return { title: t('tab.marketing') };
}

/** Marketing (M6.7a): each client's campaigns, sends and clicks over the last 30 days. */
export default async function AgencyMarketingPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const { data, canRead } = await loadAgency(org);
  if (!canRead) return null;
  const t = await getTranslations('agency');
  const te = await getTranslations('emptyActions');
  const clients = await executeQuery(agencyClientsQuery, {}, data.ctx, ports);
  if (clients.length === 0)
    return (
      <EmptyState
        title={t('emptyTitle')}
        description={t('emptyDescription', { address: data.org.slug })}
        action={
          <Link href={`/o/${org}/settings`} className={buttonClass('primary', 'md')}>
            {te('agencyAddress')}
          </Link>
        }
      />
    );
  const n = (v: number | undefined) => (v === undefined ? '—' : formatNumber(v, locale));
  const pct = (bps: number | undefined) =>
    bps === undefined
      ? '—'
      : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(bps / 10_000);
  return (
    <section aria-labelledby="agency-marketing" className="flex flex-col gap-3">
      <h2 id="agency-marketing" className="text-section">
        {t('marketingTitle')}
      </h2>
      <Table
        caption={t('marketingTitle')}
        rowKey={(c) => c.clientOrgId}
        rows={clients}
        empty={t('marketingEmpty')}
        columns={[
          {
            key: 'client',
            header: t('client'),
            cell: (c) => <span className="font-semibold">{c.name}</span>,
          },
          { key: 'campaigns', header: t('campaigns'), align: 'end', cell: (c) => n(c.snapshot?.campaigns) },
          { key: 'sends', header: t('sends'), align: 'end', cell: (c) => n(c.snapshot?.sends) },
          {
            key: 'deliveries',
            header: t('deliveries'),
            align: 'end',
            cell: (c) => n(c.snapshot?.deliveries),
          },
          { key: 'clicks', header: t('clicks'), align: 'end', cell: (c) => n(c.snapshot?.clicks) },
          {
            key: 'unique',
            header: t('uniqueClickers'),
            align: 'end',
            cell: (c) => n(c.snapshot?.uniqueClickers),
          },
          {
            key: 'conversion',
            header: t('conversion'),
            align: 'end',
            cell: (c) => pct(c.snapshot?.conversionBps),
          },
        ]}
      />
    </section>
  );
}
