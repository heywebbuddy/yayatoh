import { listCampaignsQuery } from '@yayatoh/campaigns';
import { executeQuery } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NewCampaignForm } from '@/components/campaign-panels.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createCampaignAction } from './actions.ts';
import { STATUS_TONE } from './status.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns');
  return { title: t('title') };
}

/** Marketing → Campaigns (M3.6b): every campaign with its status and reach; new drafts. */
export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string }>;
}) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:read')) notFound();
  const t = await getTranslations('campaigns');
  const canWrite = roleCan(data.role, 'marketing:write');
  const rows = await executeQuery(listCampaignsQuery, {}, data.ctx, ports);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {canWrite ? (
        <Card>
          <NewCampaignForm action={createCampaignAction.bind(null, org)} />
        </Card>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Table
          caption={t('caption')}
          rowKey={(r) => r.id}
          rows={rows}
          columns={[
            {
              key: 'name',
              header: t('name'),
              cell: (r) => (
                <Link href={`/o/${org}/campaigns/${r.id}`} className="underline underline-offset-2">
                  {r.name}
                </Link>
              ),
            },
            { key: 'channel', header: t('channel'), cell: (r) => t(`channels.${r.channel}`) },
            {
              key: 'status',
              header: t('status'),
              cell: (r) => <StatusDot status={STATUS_TONE[r.status]} label={t(`statuses.${r.status}`)} />,
            },
            {
              key: 'when',
              header: t('when'),
              cell: (r) =>
                r.completedAt
                  ? when.format(r.completedAt)
                  : r.startedAt
                    ? when.format(r.startedAt)
                    : r.scheduledAt
                      ? when.format(r.scheduledAt)
                      : '—',
            },
            {
              key: 'recipients',
              header: t('recipients'),
              align: 'end',
              cell: (r) => (
                <span className="font-mono">
                  {r.recipients === null ? '—' : formatNumber(r.recipients, locale)}
                </span>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
